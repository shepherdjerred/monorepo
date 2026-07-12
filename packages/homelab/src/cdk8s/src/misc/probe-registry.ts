import type { ProbeModule } from "./blackbox-modules.ts";

export type BackendProbeDescriptor = {
  namespace: string;
  serviceName: string;
  port: number;
  module: ProbeModule;
};

export type PublicProbeDescriptor = {
  namespace: string;
  serviceName: string;
  fqdn: string;
  module: ProbeModule;
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
 * from both call sites (confirmed at every overlap site in this repo), and
 * the second registration is a silent no-op rather than a duplicate Probe.
 */
export function registerBackendProbe(descriptor: {
  namespace: string;
  serviceName: string;
  port: number;
  module?: ProbeModule;
}): void {
  const key = backendKey(
    descriptor.namespace,
    descriptor.serviceName,
    descriptor.port,
  );
  if (backendProbes.has(key)) return;
  backendProbes.set(key, {
    namespace: descriptor.namespace,
    serviceName: descriptor.serviceName,
    port: descriptor.port,
    module: descriptor.module ?? "http_2xx",
  });
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
}): void {
  publicProbes.push({
    namespace: descriptor.namespace,
    serviceName: descriptor.serviceName,
    fqdn: descriptor.fqdn,
    module: descriptor.module ?? "http_2xx",
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
