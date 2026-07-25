import type { ProbeModule } from "./blackbox-modules.ts";

export type BackendProbeDescriptor = {
  namespace: string;
  serviceName: string;
  port: number;
  module: ProbeModule;
  /**
   * URL path the in-cluster HTTP probe requests (e.g. "/ready"). Only
   * meaningful for HTTP modules — a `tcp_connect` probe ignores it. Defaults
   * to "/".
   */
  path: string;
};

export type PublicProbeDescriptor = {
  namespace: string;
  serviceName: string;
  fqdn: string;
  module: ProbeModule;
  /**
   * URL path the public HTTP probe requests (e.g. "/healthz"). Only meaningful
   * for HTTP modules — a `tcp_connect` probe ignores it. Defaults to "/".
   */
  path: string;
};

// Module-level singletons: the whole cdk8s synth (`app.ts`) runs in one
// process, so every resource file that calls registerBackendProbe/
// registerPublicProbe during chart construction shares these same instances.
// createServiceProbesChart (wired as the last step in setup-charts.ts) reads
// them once everything else has finished registering.
const backendProbes = new Map<string, BackendProbeDescriptor>();
const publicProbes: PublicProbeDescriptor[] = [];

function backendKey(
  namespace: string,
  serviceName: string,
  port: number,
): string {
  return `${namespace}/${serviceName}:${String(port)}`;
}

/**
 * Registers an in-cluster health probe for a service. Called automatically
 * by `TailscaleIngress`/`createIngress`/`createCloudflareTunnelBinding` — no
 * resource file should call this directly.
 *
 * Idempotent by design: a service reachable via both Tailscale and a
 * Cloudflare Tunnel registers the identical {namespace, serviceName, port}
 * from both call sites, and the second registration is a no-op rather than a
 * duplicate Probe. A re-registration whose module or path DIFFERS from the
 * stored one throws: silently keeping whichever call site happened to run
 * first would leave one of the two call sites' probe intent unapplied.
 */
export function registerBackendProbe(descriptor: {
  namespace: string;
  serviceName: string;
  port: number;
  module?: ProbeModule;
  path?: string;
}): void {
  const key = backendKey(
    descriptor.namespace,
    descriptor.serviceName,
    descriptor.port,
  );
  const resolved: BackendProbeDescriptor = {
    namespace: descriptor.namespace,
    serviceName: descriptor.serviceName,
    port: descriptor.port,
    module: descriptor.module ?? "http_2xx",
    path: descriptor.path ?? "/",
  };
  const existing = backendProbes.get(key);
  if (existing !== undefined) {
    if (
      existing.module !== resolved.module ||
      existing.path !== resolved.path
    ) {
      throw new Error(
        `registerBackendProbe(${key}): conflicting duplicate registration — ` +
          `already registered with module "${existing.module}" path "${existing.path}", ` +
          `re-registered with module "${resolved.module}" path "${resolved.path}". ` +
          `Pass identical probeModule/probePath at every call site for this service.`,
      );
    }
    return;
  }
  backendProbes.set(key, resolved);
}

/**
 * Registers a public-hostname probe — a real request to the Cloudflare
 * Tunnel-fronted hostname, over the internet, from the blackbox-exporter
 * pod. Called automatically by `createCloudflareTunnelBinding`. Never
 * deduped: each public hostname is registered exactly once by construction
 * (one `createCloudflareTunnelBinding` call per public hostname).
 */
export function registerPublicProbe(descriptor: {
  namespace: string;
  serviceName: string;
  fqdn: string;
  module?: ProbeModule;
  path?: string;
}): void {
  publicProbes.push({
    namespace: descriptor.namespace,
    serviceName: descriptor.serviceName,
    fqdn: descriptor.fqdn,
    module: descriptor.module ?? "http_2xx",
    path: descriptor.path ?? "/",
  });
}

export function getRegisteredBackendProbes(): BackendProbeDescriptor[] {
  return [...backendProbes.values()];
}

export function getRegisteredPublicProbes(): PublicProbeDescriptor[] {
  return [...publicProbes];
}

/**
 * Clears both registries. Called at the top of `setupCharts()` so every
 * independent full-app synth starts clean — necessary because this module's
 * state is process-global: the test suite's ~28 files each construct their
 * own `App` and call `setupCharts()` (or an individual chart-creation
 * function) within the same bun:test process, so without a reset here,
 * registrations from one test's synth would leak into the next and
 * `createServiceProbesChart` would try to create duplicate-named Probe
 * constructs for a service registered by more than one prior test run.
 * Also used directly by probe-registry.test.ts to isolate its own cases.
 */
export function resetProbeRegistry(): void {
  backendProbes.clear();
  publicProbes.length = 0;
}
