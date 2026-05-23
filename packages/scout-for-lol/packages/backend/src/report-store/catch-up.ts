import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { importReportStoreFromS3 } from "#src/report-store/s3-importer.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-store-catch-up");

const DEFAULT_MAX_OBJECTS_PER_PREFIX = 500;
const DEFAULT_BATCH_SIZE = 50;
const PREFIXES = [
  { label: "games", prefix: "games/" },
  { label: "prematch", prefix: "prematch/" },
];

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw.length === 0) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function catchUpSourceBase(): string {
  return (
    Bun.env["REPORT_STORE_CATCH_UP_SOURCE"] ??
    `${configuration.environment}-live-report-store-catch-up`
  );
}

export async function runReportStoreS3CatchUp(): Promise<void> {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined || bucket.length === 0) {
    logger.info("[ReportStoreCatchUp] S3 bucket is not configured; skipping");
    return;
  }

  const maxObjects = parsePositiveIntEnv(
    "REPORT_STORE_CATCH_UP_MAX_OBJECTS_PER_PREFIX",
    DEFAULT_MAX_OBJECTS_PER_PREFIX,
  );
  const batchSize = parsePositiveIntEnv(
    "REPORT_STORE_CATCH_UP_BATCH_SIZE",
    DEFAULT_BATCH_SIZE,
  );
  const sourceBase = catchUpSourceBase();

  for (const { label, prefix } of PREFIXES) {
    const source = `${sourceBase}:${label}`;
    const summary = await importReportStoreFromS3({
      prisma,
      bucket,
      source,
      prefixes: [prefix],
      maxObjects,
      batchSize,
      resume: true,
    });
    logger.info(
      `[ReportStoreCatchUp] ${label} import scanned=${summary.scannedObjects.toString()} imported=${summary.importedObjects.toString()} skipped=${summary.skippedObjects.toString()} failed=${summary.failedObjects.toString()} lastKey=${summary.lastKey ?? "none"}`,
    );
  }
}
