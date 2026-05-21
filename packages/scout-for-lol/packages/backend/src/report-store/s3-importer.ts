import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  RawCurrentGameInfoSchema,
  RawMatchSchema,
  RawTimelineSchema,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  upsertStoredMatchWithFacts,
  upsertStoredPrematchWithFacts,
  upsertStoredTimeline,
} from "#src/report-store/store.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

export type ReportStoreS3ImportOptions = {
  prisma: ExtendedPrismaClient;
  bucket: string;
  source: string;
  prefixes?: string[];
  maxObjects?: number | undefined;
  batchSize?: number | undefined;
  resume?: boolean | undefined;
  client?: S3Client;
};

export type ReportStoreS3ImportSummary = {
  scannedObjects: number;
  importedObjects: number;
  skippedObjects: number;
  failedObjects: number;
  lastKey: string | undefined;
  durationMs: number;
};

type PayloadType = "match" | "timeline" | "prematch" | "ignored";

type ListImportKeysParams = {
  client: S3Client;
  bucket: string;
  prefix: string;
  startAfter: string | undefined;
  maxKeys: number;
};

type RecordFailureParams = {
  prisma: ExtendedPrismaClient;
  source: string;
  key: string;
  payloadType: PayloadType;
  error: unknown;
};

type ImportKeyParams = {
  prisma: ExtendedPrismaClient;
  client: S3Client;
  bucket: string;
  source: string;
  key: string;
};

type SavedImportProgress = Awaited<ReturnType<typeof markImportStarted>>;

const DEFAULT_PREFIXES = ["games/", "prematch/"];
const DEFAULT_BATCH_SIZE = 25;
const MAX_FAILURE_MESSAGE_LENGTH = 2000;
const MAX_IMPORT_ATTEMPTS = 3;
const IMPORT_RETRY_DELAY_MS = 500;
const TRANSIENT_IMPORT_ERROR_PATTERNS = [
  "Operation has timed out",
  "SocketTimeout",
  "database is locked",
];

function isTransientImportError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return TRANSIENT_IMPORT_ERROR_PATTERNS.some((pattern) =>
    message.includes(pattern),
  );
}

function classifyKey(key: string): PayloadType {
  if (key.startsWith("games/") && key.endsWith("/match.json")) {
    return "match";
  }
  if (key.startsWith("games/") && key.endsWith("/timeline.json")) {
    return "timeline";
  }
  if (key.startsWith("prematch/") && key.endsWith("/spectator-data.json")) {
    return "prematch";
  }
  return "ignored";
}

function observedAtFromPrematchKey(key: string): Date {
  const match = /^prematch\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(key);
  if (match === null) {
    return new Date();
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return new Date();
  }

  return new Date(Date.UTC(year, month - 1, day));
}

async function readS3ObjectText(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  if (response.Body === undefined) {
    throw new Error(`S3 object has no body: ${key}`);
  }

  return await response.Body.transformToString();
}

async function listImportKeys(
  params: ListImportKeysParams,
): Promise<{ keys: string[]; nextToken: string | undefined }> {
  const response = await params.client.send(
    new ListObjectsV2Command({
      Bucket: params.bucket,
      Prefix: params.prefix,
      StartAfter: params.startAfter,
      MaxKeys: params.maxKeys,
    }),
  );

  return {
    keys: (response.Contents ?? []).flatMap((object) =>
      object.Key === undefined ? [] : [object.Key],
    ),
    nextToken: response.NextContinuationToken,
  };
}

async function markImportStarted(
  prisma: ExtendedPrismaClient,
  source: string,
): Promise<{
  lastKey: string | undefined;
  scannedObjects: number;
  importedObjects: number;
  skippedObjects: number;
  failedObjects: number;
}> {
  const now = new Date();
  const progress = await prisma.reportStoreImportProgress.upsert({
    where: { source },
    create: {
      source,
      importStatus: "RUNNING",
      startedAt: now,
    },
    update: {
      importStatus: "RUNNING",
      completedAt: null,
    },
  });

  return {
    lastKey: progress.lastKey ?? undefined,
    scannedObjects: progress.scannedObjects,
    importedObjects: progress.importedObjects,
    skippedObjects: progress.skippedObjects,
    failedObjects: progress.failedObjects,
  };
}

async function updateProgress(
  prisma: ExtendedPrismaClient,
  source: string,
  summary: ReportStoreS3ImportSummary,
  importStatus: "RUNNING" | "COMPLETE",
): Promise<void> {
  await prisma.reportStoreImportProgress.update({
    where: { source },
    data: {
      importStatus,
      lastKey: summary.lastKey ?? null,
      scannedObjects: summary.scannedObjects,
      importedObjects: summary.importedObjects,
      skippedObjects: summary.skippedObjects,
      failedObjects: summary.failedObjects,
      completedAt: importStatus === "COMPLETE" ? new Date() : null,
    },
  });
}

async function recordFailure(params: RecordFailureParams): Promise<void> {
  const errorMessage = getErrorMessage(params.error).slice(
    0,
    MAX_FAILURE_MESSAGE_LENGTH,
  );
  await params.prisma.reportStoreImportFailure.upsert({
    where: {
      source_s3Key_payloadType: {
        source: params.source,
        s3Key: params.key,
        payloadType: params.payloadType,
      },
    },
    create: {
      source: params.source,
      s3Key: params.key,
      payloadType: params.payloadType,
      errorMessage,
    },
    update: {
      errorMessage,
    },
  });
}

async function tryRecordFailure(params: RecordFailureParams): Promise<void> {
  for (let attempt = 1; attempt <= MAX_IMPORT_ATTEMPTS; attempt++) {
    try {
      await recordFailure(params);
      return;
    } catch (error) {
      if (attempt === MAX_IMPORT_ATTEMPTS || !isTransientImportError(error)) {
        throw error;
      }
      await Bun.sleep(IMPORT_RETRY_DELAY_MS * attempt);
    }
  }
}

async function importKeyOnce(
  params: ImportKeyParams,
): Promise<"imported" | "skipped" | "failed"> {
  const payloadType = classifyKey(params.key);
  if (payloadType === "ignored") {
    return "skipped";
  }

  const body = await readS3ObjectText(params.client, params.bucket, params.key);
  const parsedJson: unknown = JSON.parse(body);

  if (payloadType === "match") {
    const rawMatch = RawMatchSchema.parse(parsedJson);
    await upsertStoredMatchWithFacts(params.prisma, rawMatch, {
      s3Key: params.key,
      importedFromS3: true,
    });
    return "imported";
  }

  if (payloadType === "timeline") {
    const rawTimeline = RawTimelineSchema.parse(parsedJson);
    await upsertStoredTimeline(params.prisma, rawTimeline, {
      s3Key: params.key,
      importedFromS3: true,
    });
    return "imported";
  }

  const rawPrematch = RawCurrentGameInfoSchema.parse(parsedJson);
  await upsertStoredPrematchWithFacts(
    params.prisma,
    rawPrematch,
    observedAtFromPrematchKey(params.key),
    {
      s3Key: params.key,
      importedFromS3: true,
    },
  );
  return "imported";
}

async function importKey(
  params: ImportKeyParams,
): Promise<"imported" | "skipped" | "failed"> {
  const payloadType = classifyKey(params.key);
  if (payloadType === "ignored") {
    return "skipped";
  }

  for (let attempt = 1; attempt <= MAX_IMPORT_ATTEMPTS; attempt++) {
    try {
      return await importKeyOnce(params);
    } catch (error) {
      if (attempt < MAX_IMPORT_ATTEMPTS && isTransientImportError(error)) {
        await Bun.sleep(IMPORT_RETRY_DELAY_MS * attempt);
        continue;
      }
      await tryRecordFailure({
        prisma: params.prisma,
        source: params.source,
        key: params.key,
        payloadType,
        error,
      });
      return "failed";
    }
  }

  await tryRecordFailure({
    prisma: params.prisma,
    source: params.source,
    key: params.key,
    payloadType,
    error: new Error(
      `Import failed after ${MAX_IMPORT_ATTEMPTS.toString()} attempts`,
    ),
  });
  return "failed";
}

function createInitialSummary(
  savedProgress: SavedImportProgress,
  resume: boolean,
): ReportStoreS3ImportSummary {
  return {
    scannedObjects: resume ? savedProgress.scannedObjects : 0,
    importedObjects: resume ? savedProgress.importedObjects : 0,
    skippedObjects: resume ? savedProgress.skippedObjects : 0,
    failedObjects: resume ? savedProgress.failedObjects : 0,
    lastKey: resume ? savedProgress.lastKey : undefined,
    durationMs: 0,
  };
}

function scannedThisRun(
  summary: ReportStoreS3ImportSummary,
  initialScannedObjects: number,
): number {
  return summary.scannedObjects - initialScannedObjects;
}

function shouldContinueImporting(params: {
  summary: ReportStoreS3ImportSummary;
  initialScannedObjects: number;
  maxObjects: number | undefined;
}): boolean {
  return (
    params.maxObjects === undefined ||
    scannedThisRun(params.summary, params.initialScannedObjects) <
      params.maxObjects
  );
}

function remainingBatchSize(params: {
  batchSize: number;
  maxObjects: number | undefined;
  summary: ReportStoreS3ImportSummary;
  initialScannedObjects: number;
}): number {
  if (params.maxObjects === undefined) {
    return params.batchSize;
  }

  return Math.min(
    params.batchSize,
    params.maxObjects -
      scannedThisRun(params.summary, params.initialScannedObjects),
  );
}

export async function importReportStoreFromS3(
  options: ReportStoreS3ImportOptions,
): Promise<ReportStoreS3ImportSummary> {
  const startedAt = Date.now();
  const client = options.client ?? createS3Client();
  const prefixes = options.prefixes ?? DEFAULT_PREFIXES;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const resume = options.resume ?? true;
  const savedProgress = await markImportStarted(options.prisma, options.source);
  const summary = createInitialSummary(savedProgress, resume);

  const initialScannedObjects = summary.scannedObjects;
  for (const prefix of prefixes) {
    let startAfter =
      summary.lastKey?.startsWith(prefix) === true
        ? summary.lastKey
        : undefined;

    while (
      shouldContinueImporting({
        summary,
        initialScannedObjects,
        maxObjects: options.maxObjects,
      })
    ) {
      const remaining = remainingBatchSize({
        batchSize,
        maxObjects: options.maxObjects,
        summary,
        initialScannedObjects,
      });
      if (remaining <= 0) {
        break;
      }

      const listed = await listImportKeys({
        client,
        bucket: options.bucket,
        prefix,
        startAfter,
        maxKeys: remaining,
      });

      if (listed.keys.length === 0) {
        break;
      }

      for (const key of listed.keys) {
        const result = await importKey({
          prisma: options.prisma,
          client,
          bucket: options.bucket,
          source: options.source,
          key,
        });
        summary.scannedObjects++;
        summary.lastKey = key;
        startAfter = key;

        if (result === "imported") {
          summary.importedObjects++;
        } else if (result === "skipped") {
          summary.skippedObjects++;
        } else {
          summary.failedObjects++;
        }
      }

      summary.durationMs = Date.now() - startedAt;
      await updateProgress(options.prisma, options.source, summary, "RUNNING");

      if (listed.keys.length < remaining || listed.nextToken === undefined) {
        break;
      }
    }
  }

  summary.durationMs = Date.now() - startedAt;
  await updateProgress(options.prisma, options.source, summary, "COMPLETE");
  return summary;
}
