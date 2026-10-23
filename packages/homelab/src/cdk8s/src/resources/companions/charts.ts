import { Chart, type App } from "cdk8s";
import {
  createArgoCdResources,
  createArgoCdTunnel,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/argocd.ts";
import { createKueueConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
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
import {
  createVeleroResources,
  createVeleroSchedules,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/velero.ts";
import { createSeaweedfsResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts";
import {
  BASELINE_CHART_NAMESPACE,
  ROOT_CHART,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import { createProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/project.ts";
import { renderedClusterResources } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";
import {
  adoptRootChartAddresses,
  adoptRootChartNames,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/root-addresses.ts";
import {
  COMPANION_APPLICATIONS,
  FOLLOWING_COMPANIONS,
  type CompanionApplication,
  companionChartName,
} from "@shepherdjerred/homelab/cdk8s/src/resources/companions/names.ts";

/**
 * The argocd service owns the AppProjects every Application names, so they
 * outlive the root: its companion re-renders the root's three projects.
 */
function argocdCompanion(root: Chart): (chart: Chart) => void {
  return (chart) => {
    createArgoCdResources(chart);
    createProject(chart, true, renderedClusterResources(root));
  };
}

const COMPANION_RESOURCES: Readonly<
  Record<Exclude<CompanionApplication, "argocd">, (chart: Chart) => unknown>
> = {
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
/** Objects a following companion renders, after its upstream Application. */
const FOLLOWING_RESOURCES: Readonly<Record<string, (chart: Chart) => unknown>> =
  {
    "velero-schedules": createVeleroSchedules,
    "kueue-queues": (chart) => {
      createKueueConfig(chart, true);
    },
    "argocd-tunnel": createArgoCdTunnel,
  };

function companionChart(
  app: App,
  name: string,
  render: (chart: Chart) => unknown,
): Chart {
  const chart = new Chart(app, name, {
    namespace: BASELINE_CHART_NAMESPACE,
    disableResourceNameHashes: true,
  });
  render(chart);
  adoptRootChartNames(chart);
  adoptRootChartAddresses(chart);
  return chart;
}

export function createCompanionCharts(app: App): Chart[] {
  const root = app.charts.find((chart) => chart.node.id === ROOT_CHART);
  if (root === undefined)
    throw new Error("Companion charts render after the root chart");
  return [
    ...COMPANION_APPLICATIONS.map((application) =>
      companionChart(
        app,
        companionChartName(application),
        application === "argocd"
          ? argocdCompanion(root)
          : COMPANION_RESOURCES[application],
      ),
    ),
    ...Object.values(FOLLOWING_COMPANIONS).map((name) => {
      const render = FOLLOWING_RESOURCES[name];
      if (render === undefined)
        throw new Error(`Following companion ${name} has no resources`);
      return companionChart(app, name, render);
    }),
  ];
}
