import { AlertService } from "#application/alert-service";
import type { PreviewPort } from "#application/ports";
import { AlertmanagerClient } from "#infrastructure/alertmanager-client";
import { readConfig } from "#infrastructure/config";
import { GrafanaPreviewClient } from "#infrastructure/grafana-preview-client";
import {
  initializeTracing,
  shutdownTracing,
} from "#infrastructure/observability";
import { PostalClient, disabledPostal } from "#infrastructure/postal-client";
import { createPrismaRepository } from "#infrastructure/prisma-repository";
import { createApp } from "#server/app";
import { ChangeBus } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import { reconcileAndPublish } from "#server/reconciliation";
import { serializedWorker } from "#server/serialized-worker";
import { systemClock } from "#shared/time";

const config = readConfig(Bun.env);
initializeTracing({
  enabled: config.TELEMETRY_ENABLED,
  serviceName: config.OTEL_SERVICE_NAME,
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const repository = await createPrismaRepository(config.DATABASE_URL);
const alertmanager = new AlertmanagerClient(config.ALERTMANAGER_URL);
const grafanaPreviews = new GrafanaPreviewClient({
  baseUrl: config.GRAFANA_URL,
  token: config.GRAFANA_API_KEY,
  prometheusUid: config.GRAFANA_PROMETHEUS_DATASOURCE_UID,
  lokiUid: config.GRAFANA_LOKI_DATASOURCE_UID,
  tempoUid: config.GRAFANA_TEMPO_DATASOURCE_UID,
  allowedGeneratorHosts: config.PROMETHEUS_GENERATOR_HOSTS.split(",").map(
    (host) => host.trim(),
  ),
});
const metrics = new Metrics();
const previews: PreviewPort = {
  health: () => grafanaPreviews.health(),
  previews: async (input, alert) => {
    const result = await grafanaPreviews.previews(input, alert);
    for (const [source, preview] of Object.entries(result)) {
      if (preview.status === "error")
        metrics.increment("alert_dashboard_preview_failure_total", { source });
    }
    return result;
  },
};

function postalClient(): PostalClient {
  const {
    POSTAL_API_KEY,
    POSTAL_FROM,
    POSTAL_HOST,
    POSTAL_HOST_HEADER,
    POSTAL_TO,
  } = config;
  if (
    POSTAL_API_KEY === undefined ||
    POSTAL_FROM === undefined ||
    POSTAL_HOST === undefined ||
    POSTAL_TO === undefined
  ) {
    throw new Error("Postal configuration is incomplete");
  }
  return new PostalClient({
    apiKey: POSTAL_API_KEY,
    from: POSTAL_FROM,
    host: POSTAL_HOST,
    to: POSTAL_TO,
    ...(POSTAL_HOST_HEADER === undefined
      ? {}
      : { hostHeader: POSTAL_HOST_HEADER }),
  });
}

const service = new AlertService({
  repository,
  alertmanager,
  postal: config.EMAIL_ENABLED ? postalClient() : disabledPostal,
  previews,
  clock: systemClock,
  emailEnabled: config.EMAIL_ENABLED,
});
const changes = new ChangeBus();
const app = createApp({
  service,
  changes,
  metrics,
  webhookToken: config.ALERT_DASHBOARD_WEBHOOK_TOKEN,
});
const server = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  idleTimeout: 30,
  fetch: app.fetch,
});
console.warn(
  JSON.stringify({
    level: "info",
    message: "alert_dashboard_started",
    hostname: server.hostname,
    port: server.port,
  }),
);

async function reconcile(): Promise<void> {
  try {
    await reconcileAndPublish(service, changes, metrics);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "reconciliation_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function drainEmail(): Promise<void> {
  const processed = await service.drainEmailOutbox();
  if (processed > 0) {
    metrics.increment("alert_dashboard_email_attempt_total", {}, processed);
    changes.publish("email");
  }
}

async function purge(): Promise<void> {
  const purged = await service.purgeExpiredRawPayloads();
  if (purged > 0) changes.publish("retention");
}

const runReconciliationWorker = serializedWorker(async () => {
  try {
    await reconcile();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "reconciliation_worker_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

const runEmailWorker = serializedWorker(async () => {
  try {
    await drainEmail();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "email_worker_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

async function runRetentionWorker(): Promise<void> {
  try {
    await purge();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "retention_worker_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

void runReconciliationWorker();
const reconciliationTimer = setInterval(
  () => void runReconciliationWorker(),
  15_000,
);
const emailTimer = setInterval(() => void runEmailWorker(), 5000);
const retentionTimer = setInterval(
  () => void runRetentionWorker(),
  60 * 60 * 1000,
);

async function shutdown(): Promise<void> {
  clearInterval(reconciliationTimer);
  clearInterval(emailTimer);
  clearInterval(retentionTimer);
  await server.stop();
  await service.disconnect();
  await shutdownTracing();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
