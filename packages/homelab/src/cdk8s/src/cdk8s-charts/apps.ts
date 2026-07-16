import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createOnePasswordApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/1password.ts";
import { createArgoCdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/argocd.ts";
import { createPrometheusApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/prometheus.ts";
import { createPrometheusAdapterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/prometheus-adapter.ts";
import { createBlackboxExporterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/blackbox-exporter.ts";
import { createTailscaleApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/tailscale.ts";
import { createIntelDevicePluginOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/intel-device-plugin-operator.ts";
import { createIntelGpuDevicePluginApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/intel-gpu-device-plugin.ts";
import { createCertManagerApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/cert-manager.ts";
import { createCloudflareOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/cloudflare-operator.ts";
import { createNfdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/nfd.ts";
import { createChartMuseumApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/chartmuseum.ts";
import { createMinecraftSjerredApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-sjerred.ts";
import { createMinecraftShuxinApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-shuxin.ts";
import { createMinecraftTsmcApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-tsmc.ts";
import { createMinecraftAllthemonsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-allthemons.ts";
import { createMinecraftStoneblock4App } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-stoneblock4.ts";
import { createMinecraftBettermcApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-bettermc.ts";
import { createMinecraftAllofcreateApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-allofcreate.ts";
import { createMinecraftFtbskies2App } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-ftbskies2.ts";
import { createMcRouterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/mc-router.ts";
import { createLokiApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/loki.ts";
import { createPromtailApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/promtail.ts";
import { createTempoApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/tempo.ts";
import { createPyroscopeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/pyroscope.ts";
import { createAlloyApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/alloy.ts";
import { Namespace } from "cdk8s-plus-31";
import { createStorageClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { createPriorityClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { createOpenEBSApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/openebs.ts";
import { createBuildkiteApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite.ts";
import { createVeleroApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/velero.ts";
import { createPostgresOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/postgres-operator.ts";
import { createSeaweedfsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/seaweedfs.ts";
import { createAllGrafanaDashboards } from "@shepherdjerred/homelab/cdk8s/src/resources/grafana/index.ts";
import { createDdnsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ddns.ts";
import { createAppsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps.ts";
import { createScoutBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/scout-beta.ts";
import { createScoutProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/scout-prod.ts";
import { createStarlightKarmaBotBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/starlight-karma-bot-beta.ts";
import { createStarlightKarmaBotProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/starlight-karma-bot-prod.ts";
import { createProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/project.ts";
import { createRedlibApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/redlib.ts";
import { createPlausibleApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/plausible.ts";
import { createBirmelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/birmel.ts";
import { createCloudflareTunnelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/cloudflare-tunnel.ts";
import { createMediaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media.ts";
import { createHomeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/home.ts";
import { createPostalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/postal.ts";
import { createSyncthingApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/syncthing.ts";
import { createGolinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/golink.ts";
import { createFreshrssApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/freshrss.ts";
import { createPinchtabApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/pinchtab.ts";
import { createPokemonApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/pokemon.ts";
import { createMarioKartApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/mario-kart.ts";
import { createGickupApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/gickup.ts";
import { createGrafanaDbApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/grafana-db.ts";
import { createS3StaticSitesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/s3-static-sites.ts";
import { createKueueApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/kueue.ts";
import { createKueueConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { createCpuPowerCap } from "@shepherdjerred/homelab/cdk8s/src/resources/cpu-power-cap.ts";
import { createKyvernoApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/kyverno.ts";
import { createKyvernoPoliciesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/kyverno-policies.ts";
import { createMcpGatewayApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/mcp-gateway.ts";
import { createBugsinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/bugsink.ts";
import { createTasknotesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/tasknotes.ts";
import { createRelayApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/relay.ts";
import { createTemporalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/temporal.ts";
import { createTrmnlDashboardApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/trmnl-dashboard.ts";
// import { createTurboCacheApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/turbo-cache.ts"; // staged: todo turbo-cache-rollout

export async function createAppsChart(app: App) {
  const chart = new Chart(app, "apps", {
    namespace: "argocd",
    disableResourceNameHashes: true,
  });

  createStorageClasses(chart);
  createPriorityClasses(chart);

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
  createMinecraftAllthemonsApp(chart);
  createMinecraftStoneblock4App(chart);
  createMinecraftBettermcApp(chart);
  createMinecraftAllofcreateApp(chart);
  createMinecraftFtbskies2App(chart);
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
  // See packages/docs/logs/2026-05-24_torvalds-thermal-investigation.md.
  createCpuPowerCap(chart, { pl1Watts: 125, pl2Watts: 253 });
  createVeleroApp(chart);
  createKyvernoApp(chart);
  createKyvernoPoliciesApp(chart);
  createPostgresOperatorApp(chart);
  createSeaweedfsApp(chart);
  // Create all Grafana dashboards (gitckup, ha-workflow, scout, smartctl, velero, zfs)
  createAllGrafanaDashboards(chart);

  // Per-service ArgoCD apps
  createDdnsApp(chart);
  createScoutBetaApp(chart);
  createScoutProdApp(chart);
  createStarlightKarmaBotBetaApp(chart);
  createStarlightKarmaBotProdApp(chart);

  // Stateless services
  createRedlibApp(chart);

  // S3-backed static sites (served via Caddy s3proxy)
  createS3StaticSitesApp(chart);

  // New namespace apps
  createPlausibleApp(chart);
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
  createPokemonApp(chart);
  createMarioKartApp(chart);
  createGickupApp(chart);
  createGrafanaDbApp(chart);
  createMcpGatewayApp(chart);
  createBugsinkApp(chart);
  createTasknotesApp(chart);
  createRelayApp(chart);
  createTemporalApp(chart);
  createTrmnlDashboardApp(chart);
  // Staged, not yet deployed: needs the turbo-cache-r2 1Password item +
  // R2 apply first (todo: turbo-cache-rollout). Uncomment together with
  // createTurboCacheChart in setup-charts.ts.
  // createTurboCacheApp(chart);

  // ArgoCD AppProject
  createProject(chart);
}
