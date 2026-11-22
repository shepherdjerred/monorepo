#!/usr/bin/env bun

/**
 * The live gate for a namespace under enforced NetworkPolicies. Read-only.
 *
 *   bun scripts/network-policy/check-namespace.ts <namespace> [--json]
 *   bun scripts/network-policy/check-namespace.ts --all [--json]
 *
 * `--all` checks every namespace that has a NetworkPolicy. Flags:
 * `--since-minutes <n>` (the window in which a restart or a Failed pod
 * counts, and denials are read; default 10) and `--allow-break-glass` (a live
 * break-glass policy otherwise fails the gate). Exits non-zero when any check
 * of any namespace fails.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { platformModel, publicHostnames } from "#platform-model";
import { breakGlassState } from "./break-glass.ts";
import {
  commandFailure,
  firstLine,
  kubectlJson,
  runCommand,
  type CommandRunner,
} from "./command.ts";
import { readEnforcerLog } from "./enforcer-log.ts";
import {
  activePods,
  EndpointSliceSchema,
  evaluateBreakGlass,
  evaluatePods,
  evaluateProbes,
  evaluateServices,
  evaluateUrlResponse,
  evaluateUrls,
  evaluateUrlsWithoutPods,
  namespaceReport,
  parseProbeSuccess,
  PodSchema,
  ServiceSchema,
  type HttpResponse,
  type NamespaceReport,
  type ProbeSuccess,
} from "./namespace-checks.ts";
import { evaluateDenials, type EnforcerLog } from "./namespace-denials.ts";
import { renderReport, renderTable } from "./report.ts";
import {
  IngressSchema,
  ProbeSchema,
  probesOfNamespace,
  selectNamespaceUrls,
  type Ingress,
  type Probe,
  type UrlCheck,
} from "./namespace-urls.ts";
import {
  NamespaceNameSchema,
  namespacesWithPolicies,
  readNetworkPolicies,
  type NetworkPolicy,
} from "./policies.ts";

const URL_TIMEOUT_MS = 15_000;

export type CheckOptions = {
  target: { namespace: string } | "all";
  json: boolean;
  sinceMinutes: number;
  allowBreakGlass: boolean;
};

const OptionsSchema = z.object({
  json: z.boolean().default(false),
  all: z.boolean().default(false),
  "since-minutes": z.coerce.number().int().positive().default(10),
  "allow-break-glass": z.boolean().default(false),
});

export function parseCheckArguments(argv: readonly string[]): CheckOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      all: { type: "boolean" },
      "since-minutes": { type: "string" },
      "allow-break-glass": { type: "boolean" },
    },
  });
  const options = OptionsSchema.parse(values);
  const [namespace, ...extra] = positionals;
  if ((namespace === undefined) === !options.all || extra.length > 0) {
    throw new Error(
      "Usage: check-namespace.ts <namespace>|--all [--json] [--since-minutes <n>] [--allow-break-glass]",
    );
  }
  return {
    target:
      namespace === undefined
        ? "all"
        : { namespace: NamespaceNameSchema.parse(namespace) },
    json: options.json,
    sinceMinutes: options["since-minutes"],
    allowBreakGlass: options["allow-break-glass"],
  };
}

/** Requests one URL without following redirects. Tests inject a fake. */
export type UrlFetcher = (url: string) => Promise<HttpResponse>;

const fetchUrl: UrlFetcher = async (url) => {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(URL_TIMEOUT_MS),
  });
  return { status: response.status, body: await response.text() };
};

export type CheckDependencies = {
  run: CommandRunner;
  fetchUrl: UrlFetcher;
  now: () => Date;
};

/** What is read once and shared by every namespace of a run. */
export type ClusterFacts = {
  policies: NetworkPolicy[];
  probes: Probe[];
  ingresses: Ingress[];
  probeSuccess: ProbeSuccess;
  enforcerLog: EnforcerLog;
};

function list<ITEM extends z.ZodType>(item: ITEM) {
  return z.object({ items: z.array(item) });
}

/** `probe_success` through toolkit; any failure is "not checked", never a pass. */
export async function readProbeSuccess(
  run: CommandRunner,
): Promise<ProbeSuccess> {
  const command = ["toolkit", "prom", "query", "probe_success", "-o", "json"];
  const result = await run(command);
  return result.exitCode === 0
    ? parseProbeSuccess(result.stdout)
    : { available: false, reason: firstLine(commandFailure(command, result)) };
}

export async function readClusterFacts(
  run: CommandRunner,
  sinceMinutes: number,
  now: Date,
): Promise<ClusterFacts> {
  const [policies, probes, ingresses, probeSuccess, enforcerLog] =
    await Promise.all([
      readNetworkPolicies(run),
      kubectlJson(
        run,
        ["get", "probes.monitoring.coreos.com", "--all-namespaces"],
        list(ProbeSchema),
      ),
      kubectlJson(
        run,
        ["get", "ingresses.networking.k8s.io", "--all-namespaces"],
        list(IngressSchema),
      ),
      readProbeSuccess(run),
      readEnforcerLog(run, sinceMinutes, now),
    ]);
  return {
    policies,
    probes: probes.items,
    ingresses: ingresses.items,
    probeSuccess,
    enforcerLog,
  };
}

async function answer(check: UrlCheck, fetcher: UrlFetcher) {
  try {
    return evaluateUrlResponse(check, await fetcher(check.url));
  } catch (error) {
    return evaluateUrlResponse(check, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function checkNamespace(
  namespace: string,
  cluster: ClusterFacts,
  dependencies: CheckDependencies,
  options: Pick<CheckOptions, "sinceMinutes" | "allowBreakGlass">,
): Promise<NamespaceReport> {
  const { run } = dependencies;
  const inNamespace = (resource: string) => [
    "--namespace",
    namespace,
    "get",
    resource,
  ];
  // An empty list is what a mistyped namespace returns, so prove it exists.
  await kubectlJson(run, ["get", "namespace", namespace], z.object({}));
  const [pods, services, slices] = await Promise.all([
    kubectlJson(run, inNamespace("pods"), list(PodSchema)),
    kubectlJson(run, inNamespace("services"), list(ServiceSchema)),
    kubectlJson(
      run,
      inNamespace("endpointslices.discovery.k8s.io"),
      list(EndpointSliceSchema),
    ),
  ]);
  const hostnames = publicHostnames();
  const urls = selectNamespaceUrls({
    namespace,
    publicHostnames: hostnames,
    tailnetServices: platformModel.tailnetServices,
    tailnetDomain: platformModel.tailnet.domain,
    probes: cluster.probes,
    ingresses: cluster.ingresses,
  });
  // A namespace scaled to zero has nothing behind its URLs to answer them.
  const runsPods = activePods(pods.items).length > 0;
  const answers = runsPods
    ? await Promise.all(
        urls.checks.map((check) => answer(check, dependencies.fetchUrl)),
      )
    : [];
  const breakGlass = breakGlassState(cluster.policies, namespace);
  return namespaceReport(namespace, breakGlass, [
    evaluateBreakGlass(namespace, breakGlass, options.allowBreakGlass),
    evaluatePods(pods.items, dependencies.now(), options.sinceMinutes),
    evaluateServices(services.items, slices.items),
    runsPods
      ? evaluateUrls(answers, urls.unchecked)
      : evaluateUrlsWithoutPods(urls.checks.length + urls.unchecked.length),
    evaluateProbes(
      probesOfNamespace(namespace, hostnames, cluster.probes),
      cluster.probeSuccess,
    ),
    evaluateDenials(namespace, cluster.enforcerLog),
  ]);
}

/** Runs the gate and returns what to print and the exit code. */
export async function runCheck(
  options: CheckOptions,
  dependencies: CheckDependencies,
): Promise<{ output: string; exitCode: number }> {
  const cluster = await readClusterFacts(
    dependencies.run,
    options.sinceMinutes,
    dependencies.now(),
  );
  if (options.target !== "all") {
    const report = await checkNamespace(
      options.target.namespace,
      cluster,
      dependencies,
      options,
    );
    return {
      output: options.json
        ? JSON.stringify(report, null, 2)
        : renderReport(report),
      exitCode: report.ok ? 0 : 1,
    };
  }
  // A break-glass policy is a policy, so its namespace is always listed.
  const namespaces = namespacesWithPolicies(cluster.policies);
  if (namespaces.length === 0) {
    // An empty gate must not read as a passed one.
    return {
      output: options.json
        ? "[]"
        : "No namespace has a NetworkPolicy; nothing was checked.",
      exitCode: 1,
    };
  }
  const reports: NamespaceReport[] = [];
  for (const namespace of namespaces) {
    reports.push(
      await checkNamespace(namespace, cluster, dependencies, options),
    );
  }
  return {
    output: options.json
      ? JSON.stringify(reports, null, 2)
      : renderTable(reports),
    exitCode: reports.every((report) => report.ok) ? 0 : 1,
  };
}

if (import.meta.main) {
  const result = await runCheck(parseCheckArguments(Bun.argv.slice(2)), {
    run: runCommand,
    fetchUrl,
    now: () => new Date(),
  });
  console.log(result.output);
  process.exitCode = result.exitCode;
}
