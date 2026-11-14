/**
 * Which URLs prove a namespace is reachable, and what each should answer.
 *
 * The hosts come from the platform model. The path and the accepted statuses
 * come from the live `Probe` resources cdk8s renders from the probe registry
 * (`cdk8s/src/misc/probes/`), so a service whose root redirects or asks for a
 * login is requested where, and judged as, its blackbox probe already is.
 */
import { z } from "zod";
import {
  BLACKBOX_MODULES,
  type ProbeModule,
} from "#cdk8s/src/misc/probes/blackbox-modules.ts";
import type { PublicHostname, TailnetService } from "#platform-model";

const ProbeModuleSchema = z.custom<ProbeModule>(
  (value) =>
    typeof value === "string" && Object.hasOwn(BLACKBOX_MODULES, value),
  "not a blackbox module of blackbox-modules.ts",
);

export const ProbeSchema = z.object({
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({
    jobName: z.string(),
    module: ProbeModuleSchema,
    targets: z.object({
      staticConfig: z.object({
        static: z.array(z.string()).min(1),
        labels: z.record(z.string(), z.string()).default({}),
      }),
    }),
  }),
});
export type Probe = z.infer<typeof ProbeSchema>;

const BackendSchema = z.object({
  service: z.object({ name: z.string() }).optional(),
});

export const IngressSchema = z.object({
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({
    ingressClassName: z.string().optional(),
    tls: z
      .array(z.object({ hosts: z.array(z.string()).default([]) }))
      .default([]),
    defaultBackend: BackendSchema.optional(),
    rules: z
      .array(
        z.object({
          http: z
            .object({ paths: z.array(z.object({ backend: BackendSchema })) })
            .optional(),
        }),
      )
      .default([]),
  }),
});
export type Ingress = z.infer<typeof IngressSchema>;

export type HttpExpectation = {
  /** Accepted final statuses; `2xx` is blackbox's default, `any` a TCP probe. */
  statuses: readonly number[] | "2xx" | "any";
  followRedirects: boolean;
  /** Regular expressions the body must all match. */
  bodyPatterns: readonly string[];
};

/** What a blackbox module accepts, as an HTTP request can check it. */
export function expectationOf(module: ProbeModule): HttpExpectation {
  const definition = BLACKBOX_MODULES[module];
  if (definition.prober === "tcp") {
    return { statuses: "any", followRedirects: false, bodyPatterns: [] };
  }
  return {
    statuses: definition.http.valid_status_codes ?? "2xx",
    followRedirects: definition.http.follow_redirects,
    bodyPatterns: definition.http.fail_if_body_not_matches_regexp ?? [],
  };
}

export type UrlCheck = {
  kind: "public" | "tailnet";
  url: string;
  module: ProbeModule;
  /** `probe`: path and module from a live Probe. `default`: `/` as `http_2xx`. */
  source: "probe" | "default";
};

export type UrlSelection = {
  checks: UrlCheck[];
  /** Declared hosts no HTTP request can check, each with the reason. */
  unchecked: string[];
};

/** A probe target is a URL, or `host:port` for a TCP module. */
function targetUrl(target: string): URL {
  return new URL(target.includes("://") ? target : `tcp://${target}`);
}

function probeTargets(probe: Probe): string[] {
  return probe.spec.targets.staticConfig.static;
}

function probeLabels(probe: Probe): Record<string, string> {
  return probe.spec.targets.staticConfig.labels;
}

function publicChecks(hostname: string, probes: readonly Probe[]): UrlCheck[] {
  const checks = probes.flatMap((probe) =>
    probeTargets(probe)
      .filter((target) => targetUrl(target).hostname === hostname)
      .map((target): UrlCheck => ({
        kind: "public",
        url: target,
        module: probe.spec.module,
        source: "probe",
      })),
  );
  return checks.length > 0
    ? checks
    : [
        {
          kind: "public",
          url: `https://${hostname}/`,
          module: "http_2xx",
          source: "default",
        },
      ];
}

function ingressBackend(ingress: Ingress): string | undefined {
  return (
    ingress.spec.defaultBackend?.service?.name ??
    ingress.spec.rules
      .flatMap((rule) => rule.http?.paths ?? [])
      .map((path) => path.backend.service?.name)
      .find((name) => name !== undefined)
  );
}

/** The in-cluster probe of a Service: where its health lives and how to judge it. */
function backendProbe(
  namespace: string,
  service: string,
  probes: readonly Probe[],
): Probe | undefined {
  return probes.find((probe) => {
    const labels = probeLabels(probe);
    return (
      labels["namespace"] === namespace &&
      labels["service"] === service &&
      labels["path"] === "internal"
    );
  });
}

function tailnetCheck(origin: string, probe: Probe | undefined): UrlCheck {
  const [target] = probe === undefined ? [] : probeTargets(probe);
  if (probe === undefined || target === undefined) {
    return {
      kind: "tailnet",
      url: `${origin}/`,
      module: "http_2xx",
      source: "default",
    };
  }
  const { prober } = BLACKBOX_MODULES[probe.spec.module];
  const path = prober === "tcp" ? "/" : targetUrl(target).pathname;
  return {
    kind: "tailnet",
    url: `${origin}${path}`,
    module: probe.spec.module,
    source: "probe",
  };
}

export type UrlSelectionInput = {
  namespace: string;
  publicHostnames: readonly PublicHostname[];
  tailnetServices: readonly TailnetService[];
  tailnetDomain: string;
  probes: readonly Probe[];
  ingresses: readonly Ingress[];
};

/** The public and tailnet URLs of one namespace, with what each should answer. */
export function selectNamespaceUrls(input: UrlSelectionInput): UrlSelection {
  const { namespace, probes } = input;
  const checks = input.publicHostnames
    .filter((entry) => entry.namespace === namespace)
    .flatMap((entry) => publicChecks(entry.hostname, probes));
  const unchecked: string[] = [];
  for (const service of input.tailnetServices) {
    if (service.namespace !== namespace) {
      continue;
    }
    const fqdn = `${service.host}.${input.tailnetDomain}`;
    if (service.exposure !== "ingress") {
      unchecked.push(`${fqdn}: ${service.exposure} exposure is not HTTP`);
      continue;
    }
    const ingress = input.ingresses.find(
      (candidate) =>
        candidate.metadata.namespace === namespace &&
        candidate.spec.ingressClassName === "tailscale" &&
        candidate.spec.tls.some((entry) => entry.hosts.includes(service.host)),
    );
    const backend = ingress === undefined ? undefined : ingressBackend(ingress);
    if (backend === undefined) {
      unchecked.push(`${fqdn}: no live tailscale Ingress serves this host`);
      continue;
    }
    checks.push(
      tailnetCheck(`https://${fqdn}`, backendProbe(namespace, backend, probes)),
    );
  }
  return { checks, unchecked };
}

/**
 * The Probes whose results speak for a namespace: those labelled with it, and
 * those that target one of its public hostnames (static sites carry no
 * namespace label).
 */
export function probesOfNamespace(
  namespace: string,
  publicHostnames: readonly PublicHostname[],
  probes: readonly Probe[],
): Probe[] {
  const hostnames = new Set(
    publicHostnames
      .filter((entry) => entry.namespace === namespace)
      .map((entry) => entry.hostname),
  );
  return probes.filter(
    (probe) =>
      probeLabels(probe)["namespace"] === namespace ||
      probeTargets(probe).some((target) =>
        hostnames.has(targetUrl(target).hostname),
      ),
  );
}
