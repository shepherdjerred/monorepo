import { App } from "cdk8s";
import { createAppsChart } from "./cdk8s-charts/apps.ts";
import { createScoutChart } from "./cdk8s-charts/scout.ts";
import { createStarlightKarmaBotChart } from "./cdk8s-charts/starlight-karma-bot.ts";
import { createDdnsChart } from "./cdk8s-charts/ddns.ts";
import { createRedlibChart } from "./cdk8s-charts/redlib.ts";
import { createBetterSkillCappedFetcherChart } from "./cdk8s-charts/better-skill-capped-fetcher.ts";
import { createPlausibleChart } from "./cdk8s-charts/plausible.ts";
import { createBirmelChart } from "./cdk8s-charts/birmel.ts";
import { createCloudflareTunnelChart } from "./cdk8s-charts/cloudflare-tunnel.ts";
import { createMediaChart } from "./cdk8s-charts/media.ts";
import { createHomeChart } from "./cdk8s-charts/home.ts";
import { createPostalChart } from "./cdk8s-charts/postal.ts";
import { createSyncthingChart } from "./cdk8s-charts/syncthing.ts";
import { createGolinkChart } from "./cdk8s-charts/golink.ts";
import { createFreshRssChart } from "./cdk8s-charts/freshrss.ts";
import { createPokemonChart } from "./cdk8s-charts/pokemon.ts";
import { createGickupChart } from "./cdk8s-charts/gickup.ts";
import { createGrafanaDbChart } from "./cdk8s-charts/grafana-db.ts";
import { createS3StaticSitesChart } from "./cdk8s-charts/s3-static-sites.ts";
import { createKyvernoPoliciesChart } from "./cdk8s-charts/kyverno-policies.ts";
import { createMcpGatewayChart } from "./cdk8s-charts/mcp-gateway.ts";
import { createOpenclawChart } from "./cdk8s-charts/openclaw.ts";
import { createBugsinkChart } from "./cdk8s-charts/bugsink.ts";
import { createDnsAuditChart } from "./cdk8s-charts/dns-audit.ts";

/**
 * Sets up all charts for the application
 */
export async function setupCharts(app: App): Promise<void> {
  await createAppsChart(app);
  createScoutChart(app, "beta");
  createScoutChart(app, "prod");
  createStarlightKarmaBotChart(app, "beta");
  createStarlightKarmaBotChart(app, "prod");

  // Per-service charts
  createDdnsChart(app);
  createRedlibChart(app);
  createBetterSkillCappedFetcherChart(app);

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
  createPokemonChart(app);
  await createGickupChart(app);
  createGrafanaDbChart(app);
  await createMcpGatewayChart(app);
  createOpenclawChart(app);
  createBugsinkChart(app);
  createDnsAuditChart(app);
}
