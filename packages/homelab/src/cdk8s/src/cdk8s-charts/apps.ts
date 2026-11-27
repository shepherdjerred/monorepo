import { createGlitterBoysLauncherApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/glitter-boys-launcher.ts";
import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createOnePasswordApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/1password.ts";
import { createArgoCdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/argocd.ts";
import { createPrometheusApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/prometheus.ts";
import { createPrometheusAdapterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/prometheus-adapter.ts";
import { createBlackboxExporterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/blackbox-exporter.ts";
import { createTailscaleApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/tailscale.ts";
import { createIntelDevicePluginOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/intel-device-plugin-operator.ts";
import { createIntelGpuDevicePluginApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/intel-gpu-device-plugin.ts";
import { createCertManagerApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/cert-manager.ts";
import { createCloudflareOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/cloudflare-operator.ts";
import { createNfdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/nfd.ts";
import { createMinecraftTsmcApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts";
import { createMcRouterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/mc-router.ts";
import { createLokiApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/loki.ts";
import { createPromtailApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/promtail.ts";
import { createTempoApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/tempo.ts";
import { createPyroscopeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/pyroscope.ts";
import { createAlloyApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alloy.ts";
import { createAlloyGatewayApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alloy-gateway.ts";
import { createStorageClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { createPriorityClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { createOpenEBSApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/openebs.ts";
import { createWoodpeckerApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker.ts";
import { createVeleroApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/velero.ts";
import { createPostgresOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/postgres-operator.ts";
import { createSeaweedfsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts";
import { createAllGrafanaDashboards } from "@shepherdjerred/homelab/cdk8s/src/resources/grafana/index.ts";
import { createAppsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/apps.ts";
import { createScoutBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/scout-beta.ts";
import { createScoutProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/scout-prod.ts";
import { createStarlightKarmaBotBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/starlight-karma-bot-beta.ts";
import { createStarlightKarmaBotProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/starlight-karma-bot-prod.ts";
import { createProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/project.ts";
import { createRedlibApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/redlib.ts";
import { createBirmelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/birmel.ts";
import { createCloudflareTunnelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/cloudflare-tunnel.ts";
import { createMediaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/media.ts";
import { createHomeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/home.ts";
import { createSyncthingApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/syncthing.ts";
import { createGolinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/golink.ts";
import { createPinchtabApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/pinchtab.ts";
import { createArcadeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/arcade.ts";
import { createGrafanaDbApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/grafana-db.ts";
import { createDeliveryDataApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/delivery-data.ts";
import { createTemporalDataApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/temporal-data.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import { createS3StaticSitesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/s3-static-sites.ts";
import { createKueueApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/kueue.ts";
import { createKueueConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { createBugsinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/bugsink.ts";
import { createTasknotesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/tasknotes.ts";
import { createTemporalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/temporal.ts";
import { createServiceProbesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/service-probes.ts";
import { createTrmnlDashboardApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/trmnl-dashboard.ts";
import { createBuildkitdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/buildkitd.ts";
import { createAlertDashboardApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alert-dashboard.ts";
import { createStashApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/stash.ts";
import { createStormBrainApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/storm-brain.ts";
import { createMcSandboxApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/mc-sandbox.ts";
import { createStormForumApplications } from "@shepherdjerred/homelab/cdk8s/src/resources/storm-forum/releases.ts";
import { createClusterAdmission } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/admission.ts";
import {
  createBaselineNamespaces,
  createCpuPowerCapGuard,
} from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/platform.ts";
import { createTrackerApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/tracker.ts";
import { createDeliveryApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/delivery.ts";
import { deliveryActivation } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/activation.ts";
import { createDeliveryControlPlaneApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/delivery-control-plane.ts";
import { deliveryExecutorActivation } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/activation.ts";

import { createFlagsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/flags.ts";

import { createStormStatsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/storm-stats.ts";

import { createMailApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/mail.ts";
import { createFeedsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/feeds.ts";
import { createErrorsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/errors.ts";

import { createChartsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/charts.ts";

import { createCiCacheApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/ci-cache.ts";

import { createArtifactsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/artifacts.ts";

export async function createAppsChart(app: App) {
  const chart = new Chart(app, "apps", {
    namespace: "argocd",
    disableResourceNameHashes: true,
  });

  createStorageClasses(chart);
  if (deliveryActivation() !== undefined) createDeliveryApp(chart);
  createTrackerApp(chart);
  createPriorityClasses(chart);
  createClusterAdmission(chart);
  createBaselineNamespaces(chart);

  createAppsApp(chart);
  createOpenEBSApp(chart);
  createOnePasswordApp(chart);
  createArgoCdApp(chart);
  createTailscaleApp(chart);
  await createPrometheusApp(chart);
  createPrometheusAdapterApp(chart);
  createBlackboxExporterApp(chart);
  createIntelDevicePluginOperatorApp(chart);
  createIntelGpuDevicePluginApp(chart);
  createCertManagerApp(chart);
  createCloudflareOperatorApp(chart);
  createNfdApp(chart);
  createMcRouterApp(chart);
  createMinecraftTsmcApp(chart);
  createLokiApp(chart);
  createPromtailApp(chart);
  createTempoApp(chart);
  createPyroscopeApp(chart);
  createAlloyApp(chart);
  createAlloyGatewayApp(chart);
  createWoodpeckerApp(chart);
  createKueueApp(chart);
  createKueueConfig(chart);
  createCpuPowerCapGuard(chart);
  createVeleroApp(chart);
  createPostgresOperatorApp(chart);
  createSeaweedfsApp(chart);
  // Create all Grafana dashboards (scout, smartctl, velero, zfs, …)
  createAllGrafanaDashboards(chart);

  // Per-service ArgoCD apps
  createScoutBetaApp(chart);
  createScoutProdApp(chart);
  createStarlightKarmaBotBetaApp(chart);
  createStarlightKarmaBotProdApp(chart);

  // Stateless services
  createRedlibApp(chart);

  // S3-backed static sites (served via Caddy s3proxy)
  createS3StaticSitesApp(chart);

  // New namespace apps
  createBirmelApp(chart);
  createCloudflareTunnelApp(chart);

  // Service apps with dedicated namespaces
  createMediaApp(chart);
  createHomeApp(chart);
  createSyncthingApp(chart);
  createGolinkApp(chart);
  createPinchtabApp(chart);
  createGlitterBoysLauncherApp(chart);
  createArcadeApp(chart);
  createGrafanaDbApp(chart);
  // Operator-run data layers take the self-hosted PostgreSQL clusters over
  // from the application charts in the cutover window's final root release.
  if (transitionRendering()) {
    createDeliveryDataApp(chart);
    createTemporalDataApp(chart);
  }
  createBugsinkApp(chart);
  createTasknotesApp(chart);
  createTemporalApp(chart);
  if (deliveryExecutorActivation() !== undefined)
    createDeliveryControlPlaneApp(chart);
  createServiceProbesApp(chart);
  createTrmnlDashboardApp(chart);
  createBuildkitdApp(chart);
  createAlertDashboardApp(chart);
  createStashApp(chart);
  createStormBrainApp(chart);
  createMcSandboxApp(chart);
  createStormForumApplications(chart);

  createFlagsApp(chart);

  createStormStatsApp(chart);

  createMailApp(chart);
  createFeedsApp(chart);
  createErrorsApp(chart);

  createChartsApp(chart);

  createCiCacheApp(chart);

  createArtifactsApp(chart);

  // ArgoCD AppProject
  createProject(chart);
}
