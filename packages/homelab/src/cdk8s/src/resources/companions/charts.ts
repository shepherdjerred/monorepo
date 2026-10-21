import { Chart, type App } from "cdk8s";
import { createArgoCdResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/argocd.ts";
import { createTailscaleResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/tailscale.ts";
import { createPrometheusResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/prometheus-resources.ts";
import { createCloudflareOperatorResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/cloudflare-operator.ts";
import { createChartMuseumResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/chartmuseum.ts";
import { createMinecraftSjerredResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-sjerred.ts";
import { createMinecraftShuxinResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-shuxin.ts";
import { createMinecraftTsmcResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts";
import { createLokiResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/loki.ts";
import { createTempoResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/tempo.ts";
import { createPyroscopeResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/pyroscope.ts";
import { createAlloyGatewayResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alloy-gateway.ts";
import { createVeleroResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/velero.ts";
import { createSeaweedfsResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts";
import { BASELINE_CHART_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import {
  adoptRootChartAddresses,
  adoptRootChartNames,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/root-addresses.ts";
import {
  COMPANION_APPLICATIONS,
  type CompanionApplication,
  companionChartName,
} from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";

const COMPANION_RESOURCES: Readonly<
  Record<CompanionApplication, (chart: Chart) => unknown>
> = {
  argocd: createArgoCdResources,
  tailscale: createTailscaleResources,
  prometheus: createPrometheusResources,
  "cloudflare-operator": createCloudflareOperatorResources,
  chartmuseum: createChartMuseumResources,
  "minecraft-sjerred": createMinecraftSjerredResources,
  "minecraft-shuxin": createMinecraftShuxinResources,
  "minecraft-tsmc": createMinecraftTsmcResources,
  loki: createLokiResources,
  tempo: createTempoResources,
  pyroscope: createPyroscopeResources,
  "alloy-gateway": createAlloyGatewayResources,
  velero: createVeleroResources,
  seaweedfs: createSeaweedfsResources,
};

/**
 * Each companion renders exactly the objects its Application constructor
 * renders into the root, with the root's names, namespace default, workload
 * addresses and sync waves, so adopting them after the root is orphaned
 * changes no byte. The root keeps rendering them until then.
 *
 * Call after the service-probes chart: the ingress and tunnel helpers
 * register probes, and the root's own calls already registered these.
 */
export function createCompanionCharts(app: App): Chart[] {
  return COMPANION_APPLICATIONS.map((application) => {
    const chart = new Chart(app, companionChartName(application), {
      namespace: BASELINE_CHART_NAMESPACE,
      disableResourceNameHashes: true,
    });
    COMPANION_RESOURCES[application](chart);
    adoptRootChartNames(chart);
    adoptRootChartAddresses(chart);
    return chart;
  });
}
