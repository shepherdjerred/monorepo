import { Context } from "@temporalio/activity";
import {
  LlmArchiveIngestRequestSchema,
  LlmArchiveIngestResponseSchema,
  LlmArchiveWatermarksResponseSchema,
  type ArchiveWatermark,
  type ArchivedSpanIndexRow,
} from "@shepherdjerred/llm-observability/llm-traces";
import {
  createStructuredLogger,
  type StructuredLogger,
} from "#observability/logging.ts";
import { redactSecrets } from "#shared/redact.ts";
import {
  createS3Sender,
  downloadAndParseArchiveWindow,
  enumerateDateKeys,
  enumerateProviderTargets,
  listDayArchiveKeys,
  type LlmArchiveS3Sender,
  type ProviderTarget,
} from "./llm-archive-s3.ts";

const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 7;
const RETENTION_DAYS = 366;
const DEFAULT_MAX_OBJECTS_PER_RUN = 2000;
const INGEST_BATCH_SIZE = 200;
const HTTP_TIMEOUT_MS = 30_000;

const log = createStructuredLogger("ops.llm-archive-index");

export type SyncLlmArchiveIndexCursor = {
  prefix: string;
  dateKey: string;
  startAfterKey?: string | undefined;
};

export type SyncLlmArchiveIndexInput = {
  lookbackDays?: number | undefined;
  maxObjectsPerRun?: number | undefined;
  cursor?: SyncLlmArchiveIndexCursor | undefined;
};

export type SyncLlmArchiveIndexResult = {
  scannedObjects: number;
  upsertedSpans: number;
  prunedSpans: number;
  hasMore: boolean;
  nextCursor?: SyncLlmArchiveIndexCursor | undefined;
};

export type LlmArchiveFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export type LlmArchiveIndexDependencies = {
  readonly s3?: LlmArchiveS3Sender | undefined;
  readonly fetchImpl?: LlmArchiveFetch | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly now?: (() => Date) | undefined;
  readonly heartbeat?: ((details: Record<string, unknown>) => void) | undefined;
  readonly logger?: StructuredLogger | undefined;
};

function requiredEnv(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for llm-archive-index`);
  }
  return value;
}

function optionalNonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? fallback : trimmed;
}

function normalizeS3Prefix(raw = "llm"): string {
  const trimmed = raw.trim().replaceAll(/^\/+|\/+$/gu, "");
  return trimmed === "" ? "llm" : trimmed;
}

function defaultHeartbeat(details: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(details);
  } catch {
    // Unit tests run outside a Temporal Activity context.
  }
}

export function utcDateKey(ms: number): string {
  const date = new Date(ms);
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

export function computeStartDateKey(input: {
  nowMs: number;
  lookbackDays?: number | undefined;
  watermark?: ArchiveWatermark | undefined;
}): string {
  if (input.lookbackDays !== undefined) {
    const days = Math.max(0, Math.floor(input.lookbackDays));
    return utcDateKey(input.nowMs - days * DAY_MS);
  }
  if (input.watermark !== undefined) {
    const yesterdayKey = utcDateKey(input.nowMs - DAY_MS);
    return input.watermark.lastDateKey.localeCompare(yesterdayKey) <= 0
      ? input.watermark.lastDateKey
      : yesterdayKey;
  }
  return utcDateKey(input.nowMs - DEFAULT_LOOKBACK_DAYS * DAY_MS);
}

async function fetchHubJson(input: {
  url: string;
  method: "GET" | "POST";
  token: string;
  body?: unknown;
  fetchImpl: LlmArchiveFetch;
  secrets: readonly (string | undefined)[];
}): Promise<unknown> {
  const response = await input.fetchImpl(input.url, {
    method: input.method,
    headers: {
      authorization: `Bearer ${input.token}`,
      ...(input.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!response.ok) {
    const responseText = await response.text();
    const raw = responseText.trim().slice(0, 300);
    const safeDetail = redactSecrets(raw, input.secrets);
    throw new Error(
      `${input.method} ${new URL(input.url).pathname} returned HTTP ${String(response.status)}${safeDetail === "" ? "" : `: ${safeDetail}`}`,
    );
  }

  return await response.json();
}

class HubBatchBuffer {
  readonly #pendingRows: ArchivedSpanIndexRow[] = [];
  readonly #pendingWatermarks = new Map<
    string,
    { watermark: ArchiveWatermark; completedAtRowCount: number }
  >();
  #enqueuedRowCount = 0;
  #sentRowCount = 0;
  scannedObjects = 0;
  upsertedSpans = 0;
  prunedSpans = 0;

  readonly #ingestUrl: string;
  readonly #token: string;
  readonly #fetchImpl: LlmArchiveFetch;
  readonly #secrets: readonly (string | undefined)[];
  readonly #heartbeat: (details: Record<string, unknown>) => void;

  constructor(options: {
    ingestUrl: string;
    token: string;
    fetchImpl: LlmArchiveFetch;
    secrets: readonly (string | undefined)[];
    heartbeat: (details: Record<string, unknown>) => void;
  }) {
    this.#ingestUrl = options.ingestUrl;
    this.#token = options.token;
    this.#fetchImpl = options.fetchImpl;
    this.#secrets = options.secrets;
    this.#heartbeat = options.heartbeat;
  }

  enqueueWindow(
    scannedCount: number,
    rows: readonly ArchivedSpanIndexRow[],
  ): void {
    this.scannedObjects += scannedCount;
    for (const row of rows) {
      this.#pendingRows.push(row);
      this.#enqueuedRowCount += 1;
    }
  }

  markDayCompleted(prefix: string, dateKey: string, nowMs: number): void {
    this.#pendingWatermarks.set(prefix, {
      watermark: { prefix, lastDateKey: dateKey, updatedAtMs: nowMs },
      completedAtRowCount: this.#enqueuedRowCount,
    });
  }

  async flushOverflow(): Promise<void> {
    while (this.#pendingRows.length > INGEST_BATCH_SIZE) {
      const batch = this.#pendingRows.splice(0, INGEST_BATCH_SIZE);
      await this.#sendBatch({ rows: batch });
    }
  }

  async flushFinal(retentionCutoffMs: number): Promise<void> {
    await this.flushOverflow();
    const finalBatch = this.#pendingRows.splice(0, INGEST_BATCH_SIZE);
    await this.#sendBatch({ rows: finalBatch, retentionCutoffMs });
  }

  async #sendBatch(options: {
    rows: ArchivedSpanIndexRow[];
    retentionCutoffMs?: number | undefined;
  }): Promise<void> {
    this.#sentRowCount += options.rows.length;
    const readyWatermarks: ArchiveWatermark[] = [];
    for (const [prefix, entry] of this.#pendingWatermarks) {
      if (entry.completedAtRowCount <= this.#sentRowCount) {
        readyWatermarks.push(entry.watermark);
        this.#pendingWatermarks.delete(prefix);
      }
    }

    const payload = LlmArchiveIngestRequestSchema.parse({
      rows: options.rows,
      watermarks: readyWatermarks,
      ...(options.retentionCutoffMs === undefined
        ? {}
        : { retentionCutoffMs: options.retentionCutoffMs }),
    });

    const rawResponse = await fetchHubJson({
      url: this.#ingestUrl,
      method: "POST",
      token: this.#token,
      body: payload,
      fetchImpl: this.#fetchImpl,
      secrets: this.#secrets,
    });
    const parsedResponse = LlmArchiveIngestResponseSchema.parse(rawResponse);
    this.upsertedSpans += parsedResponse.upsertedSpans;
    this.prunedSpans += parsedResponse.prunedSpans;

    this.#heartbeat({
      scannedObjects: this.scannedObjects,
      upsertedSpans: this.upsertedSpans,
      prunedSpans: this.prunedSpans,
      watermarksUpdated: readyWatermarks.length,
    });
  }
}

async function scanSingleDatePrefix(options: {
  s3: LlmArchiveS3Sender;
  bucket: string;
  target: ProviderTarget;
  dateKey: string;
  startAfterKey: string | undefined;
  maxObjectsPerRun: number;
  nowMs: number;
  buffer: HubBatchBuffer;
  logger: StructuredLogger;
}): Promise<SyncLlmArchiveIndexCursor | null> {
  const { keys, dayCompleted } = await listDayArchiveKeys({
    s3: options.s3,
    bucket: options.bucket,
    dayPrefix: `${options.target.watermarkPrefix}/${options.dateKey}/`,
    limit: options.maxObjectsPerRun - options.buffer.scannedObjects,
    startAfterKey: options.startAfterKey,
  });

  for (let offset = 0; offset < keys.length; offset += INGEST_BATCH_SIZE) {
    const windowKeys = keys.slice(offset, offset + INGEST_BATCH_SIZE);
    const rows = await downloadAndParseArchiveWindow({
      s3: options.s3,
      bucket: options.bucket,
      keys: windowKeys,
      target: options.target,
      logger: options.logger,
    });
    options.buffer.enqueueWindow(windowKeys.length, rows);
    await options.buffer.flushOverflow();
  }

  if (dayCompleted) {
    options.buffer.markDayCompleted(
      options.target.watermarkPrefix,
      options.dateKey,
      options.nowMs,
    );
    return null;
  }

  const lastKey = keys.at(-1);
  return {
    prefix: options.target.watermarkPrefix,
    dateKey: options.dateKey,
    ...(lastKey === undefined ? {} : { startAfterKey: lastKey }),
  };
}

async function scanProviderTarget(options: {
  s3: LlmArchiveS3Sender;
  bucket: string;
  target: ProviderTarget;
  input: SyncLlmArchiveIndexInput;
  watermark: ArchiveWatermark | undefined;
  maxObjectsPerRun: number;
  nowMs: number;
  buffer: HubBatchBuffer;
  logger: StructuredLogger;
}): Promise<SyncLlmArchiveIndexCursor | null> {
  const baseStart = computeStartDateKey({
    nowMs: options.nowMs,
    lookbackDays: options.input.lookbackDays,
    watermark: options.watermark,
  });
  const cursorMatches =
    options.input.cursor?.prefix === options.target.watermarkPrefix;
  const effectiveStart =
    cursorMatches &&
    options.input.cursor !== undefined &&
    options.input.cursor.dateKey.localeCompare(baseStart) > 0
      ? options.input.cursor.dateKey
      : baseStart;

  const dateKeys = await enumerateDateKeys(
    options.s3,
    options.bucket,
    options.target.watermarkPrefix,
    effectiveStart,
  );

  for (const dateKey of dateKeys) {
    if (options.buffer.scannedObjects >= options.maxObjectsPerRun) {
      return { prefix: options.target.watermarkPrefix, dateKey };
    }
    const startAfterKey =
      cursorMatches && options.input.cursor?.dateKey === dateKey
        ? options.input.cursor.startAfterKey
        : undefined;
    const stopCursor = await scanSingleDatePrefix({
      s3: options.s3,
      bucket: options.bucket,
      target: options.target,
      dateKey,
      startAfterKey,
      maxObjectsPerRun: options.maxObjectsPerRun,
      nowMs: options.nowMs,
      buffer: options.buffer,
      logger: options.logger,
    });
    if (stopCursor !== null) {
      return stopCursor;
    }
  }

  return null;
}

export async function runLlmArchiveIndexSync(
  input: SyncLlmArchiveIndexInput = {},
  deps: LlmArchiveIndexDependencies = {},
): Promise<SyncLlmArchiveIndexResult> {
  const env = deps.env ?? Bun.env;
  const fetchImpl: LlmArchiveFetch =
    deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  const heartbeat = deps.heartbeat ?? defaultHeartbeat;
  const logger = deps.logger ?? log;

  const opsDashboardUrl = requiredEnv("OPS_DASHBOARD_URL", env);
  const opsIngestToken = requiredEnv("OPS_INGEST_TOKEN", env);
  const bucket = optionalNonEmpty(env["LLM_ARCHIVE_S3_BUCKET"], "llm-archive");
  const s3Prefix = normalizeS3Prefix(env["LLM_ARCHIVE_S3_PREFIX"]);
  const maxObjectsPerRun = Math.max(
    1,
    Math.floor(input.maxObjectsPerRun ?? DEFAULT_MAX_OBJECTS_PER_RUN),
  );
  const s3 = deps.s3 ?? createS3Sender(env);
  const secrets = [
    opsIngestToken,
    env["AWS_ACCESS_KEY_ID"],
    env["AWS_SECRET_ACCESS_KEY"],
    env["AWS_SESSION_TOKEN"],
  ];

  const watermarksJson = await fetchHubJson({
    url: new URL("/api/traces/internal/watermarks", opsDashboardUrl).toString(),
    method: "GET",
    token: opsIngestToken,
    fetchImpl,
    secrets,
  });
  const { watermarks } =
    LlmArchiveWatermarksResponseSchema.parse(watermarksJson);
  const watermarksByPrefix = new Map(
    watermarks.map((wm) => [wm.prefix.replaceAll(/\/+$/gu, ""), wm]),
  );

  const buffer = new HubBatchBuffer({
    ingestUrl: new URL(
      "/api/traces/internal/ingest",
      opsDashboardUrl,
    ).toString(),
    token: opsIngestToken,
    fetchImpl,
    secrets,
    heartbeat,
  });

  let nextCursor: SyncLlmArchiveIndexCursor | null = null;
  const targets = await enumerateProviderTargets(s3, bucket, s3Prefix);

  for (const target of targets) {
    if (
      input.cursor !== undefined &&
      target.watermarkPrefix.localeCompare(input.cursor.prefix) < 0
    ) {
      continue;
    }
    nextCursor = await scanProviderTarget({
      s3,
      bucket,
      target,
      input,
      watermark: watermarksByPrefix.get(target.watermarkPrefix),
      maxObjectsPerRun,
      nowMs,
      buffer,
      logger,
    });
    if (nextCursor !== null) {
      break;
    }
  }

  const retentionCutoffMs = Math.max(0, nowMs - RETENTION_DAYS * DAY_MS);
  await buffer.flushFinal(retentionCutoffMs);

  return {
    scannedObjects: buffer.scannedObjects,
    upsertedSpans: buffer.upsertedSpans,
    prunedSpans: buffer.prunedSpans,
    hasMore: nextCursor !== null,
    ...(nextCursor === null ? {} : { nextCursor }),
  };
}

export async function syncLlmArchiveIndex(
  input?: SyncLlmArchiveIndexInput,
): Promise<SyncLlmArchiveIndexResult> {
  return await runLlmArchiveIndexSync(input);
}

export const llmArchiveIndexActivities = {
  syncLlmArchiveIndex,
};

export type LlmArchiveIndexActivities = typeof llmArchiveIndexActivities;
