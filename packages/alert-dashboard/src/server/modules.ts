import {
  readArchiveObject,
  type ArchiveConfig,
} from "@shepherdjerred/llm-observability";
import { LlmTraceArchiveStore } from "@shepherdjerred/llm-observability/archive-index";
import { TempoClient } from "@shepherdjerred/ops-clients/tempo.ts";

import type { AlertDashboardConfig } from "#infrastructure/config";
import type { ServerModule } from "#server/platform/module";
import { createTracesServerModule } from "../modules/traces/server.ts";

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
): readonly ServerModule[] {
  const store = LlmTraceArchiveStore.open(config.TRACES_INDEX_DB_PATH);
  const tempo =
    config.TEMPO_URL === undefined
      ? null
      : new TempoClient({ baseUrl: config.TEMPO_URL });
  const archive = configuredArchive(config);
  return [
    createTracesServerModule({
      store,
      tempo,
      archive,
      archiveReader: readArchiveObject,
      opsIngestToken: config.OPS_INGEST_TOKEN,
    }),
  ];
}
