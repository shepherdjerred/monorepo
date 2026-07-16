import type { App } from "cdk8s";
import { createAppsChart } from "./cdk8s-charts/apps.ts";
import { createScoutChart } from "./cdk8s-charts/scout.ts";
import { createStarlightKarmaBotChart } from "./cdk8s-charts/starlight-karma-bot.ts";
import { createDdnsChart } from "./cdk8s-charts/ddns.ts";
import { createRedlibChart } from "./cdk8s-charts/redlib.ts";
import { createPlausibleChart } from "./cdk8s-charts/plausible.ts";
import { createBirmelChart } from "./cdk8s-charts/birmel.ts";
import { createCloudflareTunnelChart } from "./cdk8s-charts/cloudflare-tunnel.ts";
import { createMediaChart } from "./cdk8s-charts/media.ts";
import { createHomeChart } from "./cdk8s-charts/home.ts";
import { createPostalChart } from "./cdk8s-charts/postal.ts";
import { createSyncthingChart } from "./cdk8s-charts/syncthing.ts";
import { createGolinkChart } from "./cdk8s-charts/golink.ts";
import { createFreshRssChart } from "./cdk8s-charts/freshrss.ts";
import { createPinchtabChart } from "./cdk8s-charts/pinchtab.ts";
import { createPokemonChart } from "./cdk8s-charts/pokemon.ts";
import { createMarioKartChart } from "./cdk8s-charts/mario-kart.ts";
import { createGickupChart } from "./cdk8s-charts/gickup.ts";
import { createGrafanaDbChart } from "./cdk8s-charts/grafana-db.ts";
import { createS3StaticSitesChart } from "./cdk8s-charts/s3-static-sites.ts";
import { createKyvernoPoliciesChart } from "./cdk8s-charts/kyverno-policies.ts";
import { createMcpGatewayChart } from "./cdk8s-charts/mcp-gateway.ts";
import { createBugsinkChart } from "./cdk8s-charts/bugsink.ts";
import { createTasknotesChart } from "./cdk8s-charts/tasknotes.ts";
import { createRelayChart } from "./cdk8s-charts/relay.ts";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";
import { createTrmnlDashboardChart } from "./cdk8s-charts/trmnl-dashboard.ts";
// import { createTurboCacheChart } from "./cdk8s-charts/turbo-cache.ts"; // staged: todo turbo-cache-rollout
import { createServiceProbesChart } from "./resources/monitoring/service-probes-chart.ts";
import { resetProbeRegistry } from "./misc/probe-registry.ts";

/**
 * Sets up all charts for the application
 */
export async function setupCharts(app: App): Promise<void> {
  // The probe registry is process-global module state (see probe-registry.ts)
  // — reset it so each independent setupCharts() run (the test suite calls
  // this many times per process, once per App instance) starts clean.
  resetProbeRegistry();

  await createAppsChart(app);
  createScoutChart(app, "beta");
  createScoutChart(app, "prod");
  createStarlightKarmaBotChart(app, "beta");
  createStarlightKarmaBotChart(app, "prod");

  // Per-service charts
  createDdnsChart(app);
  createRedlibChart(app);

  // S3-backed static sites
  createS3StaticSitesChart(app);

  // Kyverno policies (separate chart to ensure CRDs are installed first)
  createKyvernoPoliciesChart(app);

  // New namespace charts
  createPlausibleChart(app);
  createBirmelChart(app);
  createCloudflareTunnelChart(app);

  // Torvalds namespace charts (separate apps for easier future migration)
  createMediaChart(app);
  await createHomeChart(app);
  createPostalChart(app);
  createSyncthingChart(app);
  createGolinkChart(app);
  createFreshRssChart(app);
  createPinchtabChart(app);
  createPokemonChart(app);
  createMarioKartChart(app);
  await createGickupChart(app);
  createGrafanaDbChart(app);
  await createMcpGatewayChart(app);
  createBugsinkChart(app);
  createTasknotesChart(app);
  createRelayChart(app);
  createTemporalChart(app);
  createTrmnlDashboardChart(app);
  // Staged, not yet deployed: needs the turbo-cache-r2 1Password item +
  // R2 apply first (todo: turbo-cache-rollout). Uncomment together with
  // createTurboCacheApp in cdk8s-charts/apps.ts.
  // createTurboCacheChart(app);

  // Must run last: reads the probe registry populated by every
  // TailscaleIngress/createIngress/createCloudflareTunnelBinding call above.
  createServiceProbesChart(app);
}
