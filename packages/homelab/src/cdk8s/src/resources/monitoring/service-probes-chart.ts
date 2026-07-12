import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createHttpProbe } from "@shepherdjerred/homelab/cdk8s/src/misc/http-probe.ts";
import {
  getRegisteredBackendProbes,
  getRegisteredPublicProbes,
} from "@shepherdjerred/homelab/cdk8s/src/misc/probe-registry.ts";
import type { ProbeModule } from "@shepherdjerred/homelab/cdk8s/src/misc/blackbox-modules.ts";

function buildTargetUrl(
  module: ProbeModule,
  host: string,
  port: number,
): string {
  if (module === "tcp_connect") return `${host}:${String(port)}`;
  const scheme = module === "https_2xx_insecure" ? "https" : "http";
  return `${scheme}://${host}:${String(port)}/`;
}

/**
 * Emits the actual blackbox `Probe` resources for every service registered
 * via `TailscaleIngress` / `createIngress` / `createCloudflareTunnelBinding`
 * (see misc/probe-registry.ts). Must run after every other chart has been
 * created — wired as the last call in setup-charts.ts — so the registry is
 * fully populated by the time this reads it.
 *
 * All Probes live in the "prometheus" namespace alongside blackbox-exporter
 * itself; kube-prometheus-stack's probeSelector has no namespace
 * restriction, so they don't need to live next to their target to be picked
 * up.
 */
export function createServiceProbesChart(app: App) {
  const chart = new Chart(app, "service-probes", {
    namespace: "prometheus",
    disableResourceNameHashes: true,
  });

  for (const probe of getRegisteredBackendProbes()) {
    const slug = `${probe.namespace}-${probe.serviceName}`;
    createHttpProbe(chart, `${slug}-internal-probe`, {
      namespace: "prometheus",
      jobName: `probe-${slug}-internal`,
      url: buildTargetUrl(
        probe.module,
        `${probe.serviceName}.${probe.namespace}.svc.cluster.local`,
        probe.port,
      ),
      module: probe.module,
      labels: {
        service: probe.serviceName,
        namespace: probe.namespace,
        path: "internal",
      },
    });
  }

  for (const probe of getRegisteredPublicProbes()) {
    const slug = `${probe.namespace}-${probe.serviceName}`;
    createHttpProbe(chart, `${slug}-public-probe`, {
      namespace: "prometheus",
      jobName: `probe-${slug}-public`,
      url:
        probe.module === "tcp_connect"
          ? `${probe.fqdn}:443`
          : `https://${probe.fqdn}${probe.path}`,
      module: probe.module,
      labels: {
        service: probe.serviceName,
        namespace: probe.namespace,
        path: "public",
      },
    });
  }
}
