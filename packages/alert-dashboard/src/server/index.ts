import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import { OPS_MAILBOXES } from "@shepherdjerred/ops-model/email/mailbox.ts";

import { AlertService } from "#application/alert-service";
import { DigestService } from "#application/ops-digest-service";
import { OpsService } from "#application/ops-service";
import type { PreviewPort } from "#application/ports";
import { ReportService } from "#application/reports/report-service";
import { AlertmanagerClient } from "#infrastructure/alertmanager-client";
import { readConfig } from "#infrastructure/config";
import {
  alertEmailConfig,
  ciDashboardEnabled,
  flagMetricsRecorder,
  initFeatureFlagClient,
} from "#infrastructure/digest-flag";
import { GrafanaPreviewClient } from "#infrastructure/grafana-preview-client";
import { HomeAssistantClient } from "#infrastructure/homeassistant-client";
import {
  initializeTracing,
  shutdownTracing,
} from "#infrastructure/observability";
import { MailClient, disabledMail } from "#infrastructure/mail-client";
import { createPrismaRepositories } from "#infrastructure/prisma-repositories";
import { PrometheusSeries } from "#infrastructure/prometheus-series";
import { createApp } from "#server/app";
import { ChangeBus } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import { createServerModules } from "#server/modules";
import { closeModules } from "#server/platform/module";
import { reconcileAndPublish } from "#server/reconciliation";
import { serializedWorker } from "#server/serialized-worker";
import { systemClock } from "#shared/time";

const metrics = new Metrics();
const featureFlags = await initFeatureFlagClient({
  environment: Bun.env,
  metrics: flagMetricsRecorder({
    countEvaluation: (flag, reason, value) => {
      metrics.increment("feature_flag_evaluations_total", {
        flag,
        reason,
        value,
      });
    },
    countError: (operation) => {
      metrics.increment("feature_flag_errors_total", { operation });
    },
    providerReady: (ready) => {
      metrics.gauge("feature_flag_provider_ready", ready ? 1 : 0);
    },
    snapshotAge: (seconds) => {
      metrics.gauge("feature_flag_snapshot_age_seconds", seconds);
    },
    providerInfo: (info) => {
      metrics.clearGauge("feature_flag_provider_info");
      if (info !== undefined)
        metrics.gauge("feature_flag_provider_info", 1, info);
    },
  }),
});
const environment: Record<string, string | undefined> = Bun.env;
const config = readConfig({ ...environment, ...(await alertEmailConfig()) });
initializeTracing({
  enabled: config.TELEMETRY_ENABLED,
  serviceName: config.OTEL_SERVICE_NAME,
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const {
  ledger: repository,
  ops: opsRepository,
  ci: ciRepository,
  reports: reportRepository,
} = await createPrismaRepositories(config.DATABASE_URL);
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

/** Mail client when every setting for the mailbox pair is present. */
function configuredMail(
  from: string | undefined,
  to: string | undefined,
): MailClient | null {
  const { MAIL_API_TOKEN, MAIL_API_URL } = config;
  if (
    MAIL_API_TOKEN === undefined ||
    MAIL_API_URL === undefined ||
    from === undefined ||
    to === undefined
  ) {
    return null;
  }
  return new MailClient({
    baseUrl: MAIL_API_URL,
    token: MAIL_API_TOKEN,
    from,
    to,
  });
}

function incidentMailClient(): MailClient {
  const mail = configuredMail(config.MAIL_FROM, config.MAIL_TO);
  if (mail === null) throw new Error("Mail configuration is incomplete");
  return mail;
}

function configuredHomeAssistant(): HomeAssistantClient | null {
  const { HOMEASSISTANT_URL, HOMEASSISTANT_TOKEN } = config;
  if (HOMEASSISTANT_URL === undefined || HOMEASSISTANT_TOKEN === undefined) {
    return null;
  }
  return new HomeAssistantClient({
    baseUrl: HOMEASSISTANT_URL,
    token: HOMEASSISTANT_TOKEN,
  });
}

const service = new AlertService({
  repository,
  alertmanager,
  mail: config.EMAIL_ENABLED ? incidentMailClient() : disabledMail,
  homeAssistant: configuredHomeAssistant(),
  previews,
  clock: systemClock,
  emailEnabled: config.EMAIL_ENABLED,
});
const series = new PrometheusSeries(config.PROMETHEUS_URL);
const ops = new OpsService({
  repository: opsRepository,
  series,
  clock: systemClock,
  services: new ServiceIndex(SERVICE_CATALOG),
  grafanaUids: {
    prometheus: config.GRAFANA_PROMETHEUS_DATASOURCE_UID,
    loki: config.GRAFANA_LOKI_DATASOURCE_UID,
    tempo: config.GRAFANA_TEMPO_DATASOURCE_UID,
  },
});
const digests = new DigestService({
  repository: opsRepository,
  ops,
  series,
  mailer: configuredMail(config.MAIL_DIGEST_FROM, config.MAIL_DIGEST_TO),
  clock: systemClock,
  dailyDigestQuietClear: config.DAILY_DIGEST_QUIET_CLEAR,
});
const reports = new ReportService({
  repository: reportRepository,
  digests,
  clock: systemClock,
  digestMailbox: {
    from: config.MAIL_DIGEST_FROM ?? OPS_MAILBOXES.digests.from,
    to: config.MAIL_DIGEST_TO ?? OPS_MAILBOXES.digests.to,
  },
  incidentMailbox: {
    from: config.MAIL_FROM ?? OPS_MAILBOXES.alerts.from,
    to: config.MAIL_TO ?? OPS_MAILBOXES.alerts.to,
  },
});
const changes = new ChangeBus();
const runHomeAssistantWorker = serializedWorker(async () => {
  try {
    const processed = await service.drainHomeAssistantOutbox();
    if (processed > 0) {
      metrics.increment(
        "alert_dashboard_homeassistant_attempt_total",
        {},
        processed,
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "homeassistant_worker_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

const serverModules = createServerModules(config);
const app = createApp({
  service,
  changes,
  metrics,
  webhookToken: config.ALERT_DASHBOARD_WEBHOOK_TOKEN,
  ops,
  digests,
  reports,
  opsIngestToken: config.OPS_INGEST_TOKEN,
  ciDashboard: {
    repository: ciRepository,
    enabled: ciDashboardEnabled,
    clock: systemClock,
  },
  promotionStatusUrl: config.PROMOTION_STATUS_URL,
  onWebhookIngested: () => {
    void runHomeAssistantWorker();
  },
  modules: serverModules,
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
    await runHomeAssistantWorker();
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
  const purged = await service.purgeExpiredRecords();
  if (purged.webhookDeliveries > 0 || purged.snapshotRuns > 0)
    changes.publish("retention");
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
void runHomeAssistantWorker();
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
  await closeModules(serverModules);
  await service.disconnect();
  await featureFlags.shutdown();
  await shutdownTracing();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
