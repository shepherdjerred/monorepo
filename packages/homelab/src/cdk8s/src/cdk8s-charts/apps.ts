import { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createOnePasswordApp } from "../resources/argo-applications/1password.ts";
import { createArgoCdApp } from "../resources/argo-applications/argocd.ts";
import { createArgoCdImageUpdaterApp } from "../resources/argo-applications/argocd-image-updater.ts";
import { createPrometheusApp } from "../resources/argo-applications/prometheus.ts";
import { createPrometheusAdapterApp } from "../resources/argo-applications/prometheus-adapter.ts";
import { createBlackboxExporterApp } from "../resources/argo-applications/blackbox-exporter.ts";
import { createTailscaleApp } from "../resources/argo-applications/tailscale.ts";
import { createIntelDevicePluginOperatorApp } from "../resources/argo-applications/intel-device-plugin-operator.ts";
import { createIntelGpuDevicePluginApp } from "../resources/argo-applications/intel-gpu-device-plugin.ts";
import { createCertManagerApp } from "../resources/argo-applications/cert-manager.ts";
import { createCloudflareOperatorApp } from "../resources/argo-applications/cloudflare-operator.ts";
import { createNfdApp } from "../resources/argo-applications/nfd.ts";
import { createGrafanaApp } from "../resources/argo-applications/grafana.ts";
import { createChartMuseumApp } from "../resources/argo-applications/chartmuseum.ts";
import { createMinecraftSjerredApp } from "../resources/argo-applications/minecraft-sjerred.ts";
import { createMinecraftShuxinApp } from "../resources/argo-applications/minecraft-shuxin.ts";
import { createMinecraftTsmcApp } from "../resources/argo-applications/minecraft-tsmc.ts";
import { createMcRouterApp } from "../resources/argo-applications/mc-router.ts";
import { createLokiApp } from "../resources/argo-applications/loki.ts";
import { createPromtailApp } from "../resources/argo-applications/promtail.ts";
import { createTempoApp } from "../resources/argo-applications/tempo.ts";
import { Namespace } from "cdk8s-plus-31";
import { createStorageClasses } from "../misc/storage-classes.ts";
import { createOpenEBSApp } from "../resources/argo-applications/openebs.ts";
import { createActionsRunnerControllerApp } from "../resources/argo-applications/actions-runner-controller.ts";
import { createBuildkiteApp } from "../resources/argo-applications/buildkite.ts";
import { createDaggerApp } from "../resources/argo-applications/dagger.ts";
import { createVeleroApp } from "../resources/argo-applications/velero.ts";
import { createPostgresOperatorApp } from "../resources/argo-applications/postgres-operator.ts";
import { createCoderApp } from "../resources/argo-applications/coder.ts";
import { createSeaweedfsApp } from "../resources/argo-applications/seaweedfs.ts";
import { createAllGrafanaDashboards } from "../resources/grafana/index.ts";
import { createDdnsApp } from "../resources/argo-applications/ddns.ts";
import { createDependencySummaryCronJob } from "../resources/home/dependency-summary.ts";
import { createAppsApp } from "../resources/argo-applications/apps.ts";
import { createScoutBetaApp } from "../resources/argo-applications/scout-beta.ts";
import { createScoutProdApp } from "../resources/argo-applications/scout-prod.ts";
import { createStarlightKarmaBotBetaApp } from "../resources/argo-applications/starlight-karma-bot-beta.ts";
import { createStarlightKarmaBotProdApp } from "../resources/argo-applications/starlight-karma-bot-prod.ts";
import { createProject } from "../resources/argo-applications/project.ts";
import { createRedlibApp } from "../resources/argo-applications/redlib.ts";
import { createBetterSkillCappedFetcherApp } from "../resources/argo-applications/better-skill-capped-fetcher.ts";
import { createPlausibleApp } from "../resources/argo-applications/plausible.ts";
import { createBirmelApp } from "../resources/argo-applications/birmel.ts";
import { createCloudflareTunnelApp } from "../resources/argo-applications/cloudflare-tunnel.ts";
import { createMediaApp } from "../resources/argo-applications/media.ts";
import { createHomeApp } from "../resources/argo-applications/home.ts";
import { createPostalApp } from "../resources/argo-applications/postal.ts";
import { createSyncthingApp } from "../resources/argo-applications/syncthing.ts";
import { createGolinkApp } from "../resources/argo-applications/golink.ts";
import { createFreshrssApp } from "../resources/argo-applications/freshrss.ts";
import { createPokemonApp } from "../resources/argo-applications/pokemon.ts";
import { createGickupApp } from "../resources/argo-applications/gickup.ts";
import { createGrafanaDbApp } from "../resources/argo-applications/grafana-db.ts";
import { createS3StaticSitesApp } from "../resources/argo-applications/s3-static-sites.ts";
import { createKyvernoApp } from "../resources/argo-applications/kyverno.ts";
import { createKyvernoPoliciesApp } from "../resources/argo-applications/kyverno-policies.ts";
import { createMcpGatewayApp } from "../resources/argo-applications/mcp-gateway.ts";
import { createOpenclawApp } from "../resources/argo-applications/openclaw.ts";
import { createBugsinkApp } from "../resources/argo-applications/bugsink.ts";
import { createDnsAuditApp } from "../resources/argo-applications/dns-audit.ts";

export async function createAppsChart(app: App) {
  const chart = new Chart(app, "apps", {
    namespace: "argocd",
    disableResourceNameHashes: true,
  });

  createStorageClasses(chart);

  new Namespace(chart, `maintenance-namespace`, {
    metadata: {
      name: `maintenance`,
      labels: {
        "pod-security.kubernetes.io/audit": "restricted",
      },
    },
  });

  new Namespace(chart, `devpod-namespace`, {
    metadata: {
      name: `devpod`,
      labels: {
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  createAppsApp(chart);
  createOpenEBSApp(chart);
  createOnePasswordApp(chart);
  createArgoCdApp(chart);
  createArgoCdImageUpdaterApp(chart);
  createTailscaleApp(chart);
  await createPrometheusApp(chart);
  createPrometheusAdapterApp(chart);
  createBlackboxExporterApp(chart);
  createIntelDevicePluginOperatorApp(chart);
  createIntelGpuDevicePluginApp(chart);
  createCertManagerApp(chart);
  createCloudflareOperatorApp(chart);
  createNfdApp(chart);
  createGrafanaApp(chart);
  createChartMuseumApp(chart);
  createMcRouterApp(chart);
  createMinecraftSjerredApp(chart);
  createMinecraftShuxinApp(chart);
  createMinecraftTsmcApp(chart);
  createLokiApp(chart);
  createPromtailApp(chart);
  createTempoApp(chart);
  createActionsRunnerControllerApp(chart);
  createBuildkiteApp(chart);
  createDaggerApp(chart);
  createVeleroApp(chart);
  createKyvernoApp(chart);
  createKyvernoPoliciesApp(chart);
  createPostgresOperatorApp(chart);
  createCoderApp(chart);
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
  createBetterSkillCappedFetcherApp(chart);

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
  createPokemonApp(chart);
  createGickupApp(chart);
  createGrafanaDbApp(chart);
  createMcpGatewayApp(chart);
  createOpenclawApp(chart);
  createBugsinkApp(chart);
  createDnsAuditApp(chart);

  // ArgoCD AppProject
  createProject(chart);

  // Weekly dependency summary email
  createDependencySummaryCronJob(chart);
}
