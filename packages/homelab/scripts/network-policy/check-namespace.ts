#!/usr/bin/env bun

/**
 * The per-cutover gate of the NetworkPolicy enforcement rollout. Read-only.
 *
 *   bun scripts/network-policy/check-namespace.ts <namespace> [--json]
 *   bun scripts/network-policy/check-namespace.ts --all-staged [--json]
 *   bun scripts/network-policy/check-namespace.ts --coverage [--allow-unstaged <name-or-prefix>]... [--json]
 *
 * Flags: `--since-minutes <n>` (restart and denial window, default 10) and
 * `--expect-stage open|enforced` (fail when the live stage differs).
 * Exits non-zero when any check of any namespace fails.
 *
 * `--coverage` is the pre-switch gate: it fails while any namespace has
 * policies and pods but no staging policy.
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { platformModel, publicHostnames } from "#platform-model";
import {
  commandFailure,
  kubectlJson,
  runCommand,
  type CommandRunner,
} from "./command.ts";
import {
  coverageReport,
  PodSummarySchema,
  renderCoverage,
} from "./coverage.ts";
import {
  EndpointSliceSchema,
  evaluateDenials,
  evaluatePods,
  evaluateProbes,
  evaluateServices,
  evaluateStage,
  evaluateUrlResponse,
  evaluateUrls,
  namespaceReport,
  parseProbeSuccess,
  PodSchema,
  ServiceSchema,
  type EnforcerLog,
  type HttpResponse,
  type NamespaceReport,
  type ProbeSuccess,
} from "./namespace-checks.ts";
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
  readNetworkPolicies,
  stagedNamespaces,
  stageOf,
  stagingPolicyOf,
  type NetworkPolicy,
} from "./staging-policy.ts";

const ENFORCER_NAMESPACE = "kube-system";
const ENFORCER_DAEMONSET = "kube-flannel";
const ENFORCER_CONTAINER = "kube-network-policies";
const URL_TIMEOUT_MS = 15_000;

export type CheckOptions = {
  target: { namespace: string } | "all-staged" | "coverage";
  /** `--coverage` only: namespaces, or prefixes, excused from staging. */
  allowUnstaged: string[];
  json: boolean;
  sinceMinutes: number;
  expectStage: "open" | "enforced" | undefined;
};

const OptionsSchema = z.object({
  json: z.boolean().default(false),
  "all-staged": z.boolean().default(false),
  coverage: z.boolean().default(false),
  "allow-unstaged": z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]*\*?$/u))
    .default([]),
  "since-minutes": z.coerce.number().int().positive().default(10),
  "expect-stage": z.enum(["open", "enforced"]).optional(),
});

export function parseCheckArguments(argv: readonly string[]): CheckOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      "all-staged": { type: "boolean" },
      coverage: { type: "boolean" },
      "allow-unstaged": { type: "string", multiple: true },
      "since-minutes": { type: "string" },
      "expect-stage": { type: "string" },
    },
  });
  const options = OptionsSchema.parse(values);
  const [namespace, ...extra] = positionals;
  const targets = [
    namespace !== undefined,
    options["all-staged"],
    options.coverage,
  ].filter(Boolean).length;
  const strayAllow = !options.coverage && options["allow-unstaged"].length > 0;
  if (targets !== 1 || strayAllow || extra.length > 0) {
    throw new Error(
      "Usage: check-namespace.ts <namespace>|--all-staged [--json] [--since-minutes <n>] [--expect-stage open|enforced]\n" +
        "       check-namespace.ts --coverage [--allow-unstaged <name-or-prefix>]... [--json]",
    );
  }
  const cluster = options.coverage ? "coverage" : "all-staged";
  return {
    target:
      namespace === undefined
        ? cluster
        : { namespace: NamespaceNameSchema.parse(namespace) },
    allowUnstaged: options["allow-unstaged"],
    json: options.json,
    sinceMinutes: options["since-minutes"],
    expectStage: options["expect-stage"],
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

const DaemonSetSchema = z.object({
  spec: z.object({
    selector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
    template: z.object({
      spec: z.object({ containers: z.array(z.object({ name: z.string() })) }),
    }),
  }),
});

function firstLine(text: string): string {
  return (text.trim().split("\n")[0] ?? "").slice(0, 200);
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

/** The enforcer sidecar's log from every node, when the sidecar exists. */
export async function readEnforcerLog(
  run: CommandRunner,
  minutes: number,
): Promise<EnforcerLog> {
  const get = [
    "kubectl",
    "--namespace",
    ENFORCER_NAMESPACE,
    "get",
    "daemonset",
    ENFORCER_DAEMONSET,
    "-o",
    "json",
  ];
  const found = await run(get);
  if (found.exitCode !== 0) {
    return { available: false, reason: firstLine(commandFailure(get, found)) };
  }
  const { selector, template } = DaemonSetSchema.parse(
    JSON.parse(found.stdout),
  ).spec;
  if (
    !template.spec.containers.some(({ name }) => name === ENFORCER_CONTAINER)
  ) {
    return {
      available: false,
      reason: `${ENFORCER_DAEMONSET} has no ${ENFORCER_CONTAINER} container (enforcement is not switched on)`,
    };
  }
  // `logs ds/<name>` reads one pod only; the selector reads every node's.
  const logs = [
    "kubectl",
    "--namespace",
    ENFORCER_NAMESPACE,
    "logs",
    "--selector",
    Object.entries(selector.matchLabels)
      .map(([key, value]) => `${key}=${value}`)
      .join(","),
    "--container",
    ENFORCER_CONTAINER,
    `--since=${String(minutes)}m`,
    "--tail=-1",
    "--prefix",
  ];
  const read = await run(logs);
  return read.exitCode === 0
    ? { available: true, lines: read.stdout.split("\n"), minutes }
    : { available: false, reason: firstLine(commandFailure(logs, read)) };
}

export async function readClusterFacts(
  run: CommandRunner,
  sinceMinutes: number,
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
      readEnforcerLog(run, sinceMinutes),
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
  options: Pick<CheckOptions, "sinceMinutes" | "expectStage">,
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
  const answers = await Promise.all(
    urls.checks.map((check) => answer(check, dependencies.fetchUrl)),
  );
  const stage = stageOf(stagingPolicyOf(cluster.policies, namespace));
  return namespaceReport(namespace, stage, [
    evaluateStage(stage, options.expectStage),
    evaluatePods(pods.items, dependencies.now(), options.sinceMinutes),
    evaluateServices(services.items, slices.items),
    evaluateUrls(answers, urls.unchecked),
    evaluateProbes(
      probesOfNamespace(namespace, hostnames, cluster.probes),
      cluster.probeSuccess,
    ),
    evaluateDenials(namespace, cluster.enforcerLog),
  ]);
}

/** The pre-switch gate: reads every policy and pod, nothing else. */
async function runCoverage(
  options: CheckOptions,
  run: CommandRunner,
): Promise<{ output: string; exitCode: number }> {
  const [policies, pods] = await Promise.all([
    readNetworkPolicies(run),
    kubectlJson(
      run,
      ["get", "pods", "--all-namespaces"],
      list(PodSummarySchema),
    ),
  ]);
  const report = coverageReport(policies, pods.items, options.allowUnstaged);
  return {
    output: options.json
      ? JSON.stringify(report, null, 2)
      : renderCoverage(report),
    exitCode: report.ok ? 0 : 1,
  };
}

/** Runs the gate and returns what to print and the exit code. */
export async function runCheck(
  options: CheckOptions,
  dependencies: CheckDependencies,
): Promise<{ output: string; exitCode: number }> {
  if (options.target === "coverage") {
    return runCoverage(options, dependencies.run);
  }
  const cluster = await readClusterFacts(
    dependencies.run,
    options.sinceMinutes,
  );
  if (options.target !== "all-staged") {
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
  const namespaces = stagedNamespaces(cluster.policies);
  if (namespaces.length === 0) {
    // An empty gate must not read as a passed one.
    return {
      output: options.json
        ? "[]"
        : "No namespace has an enforcement-staging-<namespace> policy; nothing was checked.",
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
