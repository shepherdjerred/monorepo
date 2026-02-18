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
import { createGrafanaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/grafana.ts";
import { createChartMuseumApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/chartmuseum.ts";
import { createMinecraftSjerredApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-sjerred.ts";
import { createMinecraftShuxinApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-shuxin.ts";
import { createMinecraftTsmcApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/minecraft-tsmc.ts";
import { createMcRouterApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/mc-router.ts";
import { createLokiApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/loki.ts";
import { createPromtailApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/promtail.ts";
import { createTempoApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/tempo.ts";
import { Namespace } from "cdk8s-plus-31";
import { createStorageClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { createOpenEBSApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/openebs.ts";
import { createActionsRunnerControllerApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/actions-runner-controller.ts";
import { createBuildkiteApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite.ts";
import { createDaggerApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/dagger.ts";
import { createVeleroApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/velero.ts";
import { createPostgresOperatorApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/postgres-operator.ts";
import { createCoderApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/coder.ts";
import { createSeaweedfsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/seaweedfs.ts";
import { createAllGrafanaDashboards } from "@shepherdjerred/homelab/cdk8s/src/resources/grafana/index.ts";
import { createDdnsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ddns.ts";
import { createDependencySummaryCronJob } from "@shepherdjerred/homelab/cdk8s/src/resources/home/dependency-summary.ts";
import { createAppsApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/apps.ts";
import { createScoutBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/scout-beta.ts";
import { createScoutProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/scout-prod.ts";
import { createStarlightKarmaBotBetaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/starlight-karma-bot-beta.ts";
import { createStarlightKarmaBotProdApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/starlight-karma-bot-prod.ts";
import { createProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/project.ts";
import { createRedlibApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/redlib.ts";
import { createBetterSkillCappedFetcherApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/better-skill-capped-fetcher.ts";
import { createPlausibleApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/plausible.ts";
import { createBirmelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/birmel.ts";
import { createCloudflareTunnelApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/cloudflare-tunnel.ts";
import { createMediaApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/media.ts";
import { createHomeApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/home.ts";
import { createPostalApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/postal.ts";
import { createSyncthingApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/syncthing.ts";
import { createGolinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/golink.ts";
import { createFreshrssApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/freshrss.ts";
import { createPokemonApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/pokemon.ts";
import { createGickupApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/gickup.ts";
import { createGrafanaDbApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/grafana-db.ts";
import { createS3StaticSitesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/s3-static-sites.ts";
import { createKyvernoApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/kyverno.ts";
import { createKyvernoPoliciesApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/kyverno-policies.ts";
import { createMcpGatewayApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/mcp-gateway.ts";
import { createBugsinkApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/bugsink.ts";
import { createDnsAuditApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/dns-audit.ts";

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
  createBugsinkApp(chart);
  createDnsAuditApp(chart);

  // ArgoCD AppProject
  createProject(chart);

  // Weekly dependency summary email
  createDependencySummaryCronJob(chart);
}
