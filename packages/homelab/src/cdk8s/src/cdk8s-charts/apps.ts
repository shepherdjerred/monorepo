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
import { createChartMuseumApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/chartmuseum.ts";
import { createMinecraftSjerredApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-sjerred.ts";
import { createMinecraftShuxinApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-shuxin.ts";
import { createMinecraftTsmcApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts";
import { createMcRouterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/mc-router.ts";
import { createLokiApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/loki.ts";
import { createPromtailApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/promtail.ts";
import { createTempoApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/tempo.ts";
import { createPyroscopeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/pyroscope.ts";
import { createAlloyApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alloy.ts";
import { Namespace } from "cdk8s-plus-31";
import { createStorageClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { createPriorityClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { createOpenEBSApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/openebs.ts";
import { createBuildkiteApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/buildkite.ts";
import { createVeleroApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/velero.ts";
import { createPostgresOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/postgres-operator.ts";
import { createSeaweedfsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/seaweedfs.ts";
import { createAllGrafanaDashboards } from "@shepherdjerred/homelab/cdk8s/src/resources/grafana/index.ts";
import { createDdnsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/ddns.ts";
import { createAppsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/apps.ts";
import { createScoutBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/scout-beta.ts";
import { createScoutEvalsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/scout-evals.ts";
import { createScoutProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/scout-prod.ts";
import { createStarlightKarmaBotBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/starlight-karma-bot-beta.ts";
import { createStarlightKarmaBotProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/starlight-karma-bot-prod.ts";
import { createProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/project.ts";
import { createRedlibApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/redlib.ts";
import { createBirmelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/birmel.ts";
import { createCloudflareTunnelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/cloudflare-tunnel.ts";
import { createMediaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/media.ts";
import { createHomeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/home.ts";
import { createPostalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/postal.ts";
import { createSyncthingApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/syncthing.ts";
import { createGolinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/networking/golink.ts";
import { createFreshrssApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/freshrss.ts";
import { createPinchtabApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/pinchtab.ts";
import { createFliptApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/flipt.ts";
import { createPokemonApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/pokemon.ts";
import { createMarioKartApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/mario-kart.ts";
import { createGickupApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/gickup.ts";
import { createGrafanaDbApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/grafana-db.ts";
import { createS3StaticSitesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/s3-static-sites.ts";
import { createKueueApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/kueue.ts";
import { createKueueConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { createCpuPowerCap } from "@shepherdjerred/homelab/cdk8s/src/resources/cpu-power-cap.ts";
import { createBugsinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/bugsink.ts";
import { createTasknotesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/tasknotes.ts";
import { createRelayApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/relay.ts";
import { createTemporalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/temporal.ts";
import { createServiceProbesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/service-probes.ts";
import { createTrmnlDashboardApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/trmnl-dashboard.ts";
import { createTurboCacheApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/turbo-cache.ts";
import { createBuildkitdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/buildkitd.ts";
import { createAlertDashboardApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/alert-dashboard.ts";
import { createStashApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media/stash.ts";
import { createOpenRouterBroadcastIngestApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps/openrouter-broadcast-ingest.ts";
import { createPvcBackupAdmissionPolicies } from "@shepherdjerred/homelab/cdk8s/src/resources/pvc-backup-admission.ts";
import { createArgoCdApplicationAdmissionPolicies } from "@shepherdjerred/homelab/cdk8s/src/resources/argocd-application-admission.ts";

export async function createAppsChart(app: App) {
  const chart = new Chart(app, "apps", {
    namespace: "argocd",
    disableResourceNameHashes: true,
  });

  createStorageClasses(chart);
  createPriorityClasses(chart);
  createArgoCdApplicationAdmissionPolicies(chart);
  createPvcBackupAdmissionPolicies(chart);

  new Namespace(chart, `maintenance-namespace`, {
    metadata: {
      name: `maintenance`,
      labels: {
        "pod-security.kubernetes.io/audit": "restricted",
      },
    },
  });

  new Namespace(chart, "prometheus-namespace", {
    metadata: {
      name: "prometheus",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

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
  createChartMuseumApp(chart);
  createMcRouterApp(chart);
  createMinecraftSjerredApp(chart);
  createMinecraftShuxinApp(chart);
  createMinecraftTsmcApp(chart);
  createLokiApp(chart);
  createPromtailApp(chart);
  createTempoApp(chart);
  createPyroscopeApp(chart);
  createAlloyApp(chart);
  createBuildkiteApp(chart);
  createKueueApp(chart);
  createKueueConfig(chart);
  // Enforces Intel stock package power limits (PL1 125 W / PL2 253 W). ASUS
  // firmware defaults PL1 to unlimited, which drove sustained 100 °C TJMax and
  // overheated the adjacent M.2 slots before the AIO cooler was installed
  // (2026-05-26). The original emergency cap was 95/140; raised to stock once
  // the AIO + per-drive NVMe cooling were verified.
  // See the original investigation.
  createCpuPowerCap(chart, { pl1Watts: 125, pl2Watts: 253 });
  createVeleroApp(chart);
  createPostgresOperatorApp(chart);
  createSeaweedfsApp(chart);
  // Create all Grafana dashboards (gitckup, scout, smartctl, velero, zfs, …)
  createAllGrafanaDashboards(chart);

  // Per-service ArgoCD apps
  createDdnsApp(chart);
  createScoutBetaApp(chart);
  createScoutEvalsApp(chart);
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
  createPostalApp(chart);
  createSyncthingApp(chart);
  createGolinkApp(chart);
  createFreshrssApp(chart);
  createPinchtabApp(chart);
  createFliptApp(chart);
  createPokemonApp(chart);
  createMarioKartApp(chart);
  createGickupApp(chart);
  createGrafanaDbApp(chart);
  createBugsinkApp(chart);
  createTasknotesApp(chart);
  createRelayApp(chart);
  createTemporalApp(chart);
  createServiceProbesApp(chart);
  createTrmnlDashboardApp(chart);
  createTurboCacheApp(chart);
  createBuildkitdApp(chart);
  createAlertDashboardApp(chart);
  createStashApp(chart);
  createOpenRouterBroadcastIngestApp(chart);

  // ArgoCD AppProject
  createProject(chart);
}
