import {
  readArchiveObject,
  type ArchiveConfig,
} from "@shepherdjerred/llm-observability";
import { createOperatorVerifier } from "@shepherdjerred/experiments/operator-identity";
import { LlmTraceArchiveStore } from "@shepherdjerred/llm-observability/archive-index";
import { TempoClient } from "@shepherdjerred/ops-clients/tempo.ts";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";

import type { AlertDashboardConfig } from "#infrastructure/config";
import type { ServerModule } from "#server/platform/module";
import {
  createExperimentsServerModule,
  type ExperimentsUpstream,
} from "../modules/experiments/server.ts";
import { createIncidentsServerModule } from "../modules/incidents/server.ts";
import { createTracesServerModule } from "../modules/traces/server.ts";

function configuredExperiments(
  config: AlertDashboardConfig,
  peerAddress: (request: Request) => string | null,
): ExperimentsUpstream | undefined {
  const {
    EXPERIMENTS_INTERNAL_URL: origin,
    EXPERIMENTS_HUB_TOKEN: token,
    HUB_EXPERIMENTS_INGRESS_IDENTITY_DIR: identityDirectory,
    HUB_EXPERIMENTS_OPERATOR_LOGINS: logins,
    HUB_EXPERIMENTS_PUBLIC_ORIGIN: publicOrigin = APP_HOSTS.hub,
  } = config;
  if (
    origin === undefined ||
    token === undefined ||
    identityDirectory === undefined ||
    logins === undefined
  ) {
    return undefined;
  }
  const verifyOperator = createOperatorVerifier({
    ingressNamespace: "alert-dashboard",
    ingressName: "alert-dashboard-alert-dashboard-hub-ingress-ingress",
    serviceName: "alert-dashboard-alert-dashboard-service",
    port: config.PORT,
    host: "hub",
    identityDirectory,
    operatorLogins: logins
      .split(",")
      .map((login) => login.trim())
      .filter(Boolean),
    publicOrigin,
  });
  return {
    origin,
    token,
    verifyOperator: (request) => verifyOperator(request, peerAddress(request)),
  };
}

function configuredArchive(config: AlertDashboardConfig): ArchiveConfig | null {
  if (
    config.LLM_ARCHIVE_S3_BUCKET === undefined ||
    config.S3_ENDPOINT === undefined ||
    config.AWS_ACCESS_KEY_ID === undefined ||
    config.AWS_SECRET_ACCESS_KEY === undefined
  ) {
    return null;
  }
  return {
    bucket: config.LLM_ARCHIVE_S3_BUCKET,
    prefix: config.LLM_ARCHIVE_S3_PREFIX,
    region: "us-east-1",
    endpoint: config.S3_ENDPOINT,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    forcePathStyle: true,
  };
}

/**
 * The server composition root: every module mounted beside the built-in Ops
 * and alert-ledger routes. The client counterpart is `src/client/modules.ts`.
 */
export function createServerModules(
  config: AlertDashboardConfig,
  peerAddress: (request: Request) => string | null,
): readonly ServerModule[] {
  const store = LlmTraceArchiveStore.open(config.TRACES_INDEX_DB_PATH);
  const tempo =
    config.TEMPO_URL === undefined
      ? null
      : new TempoClient({ baseUrl: config.TEMPO_URL });
  const archive = configuredArchive(config);
  const experiments = configuredExperiments(config, peerAddress);
  return [
    // Flags come from the module's default reader: Hub's process-wide flag
    // client (`alert-dashboard/prod`), initialised before this runs.
    createIncidentsServerModule({
      databaseUrl: config.INCIDENTS_DATABASE_URL,
      webhookToken: config.ALERT_DASHBOARD_WEBHOOK_TOKEN,
      opsIngestToken: config.OPS_INGEST_TOKEN,
      publicOrigin: APP_HOSTS.hub,
    }),
    createTracesServerModule({
      store,
      tempo,
      archive,
      archiveReader: readArchiveObject,
      opsIngestToken: config.OPS_INGEST_TOKEN,
    }),
    ...(experiments === undefined
      ? []
      : [createExperimentsServerModule(experiments)]),
  ];
}
