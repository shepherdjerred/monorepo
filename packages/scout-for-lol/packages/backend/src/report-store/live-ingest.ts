import type {
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import * as Sentry from "@sentry/bun";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  reportStoreIngestFactsTotal,
  reportStoreIngestTotal,
} from "#src/metrics/report-store.ts";
import {
  upsertStoredMatchWithFacts,
  upsertStoredPrematchWithFacts,
  upsertStoredTimeline,
} from "#src/report-store/store.ts";
import { createLogger } from "#src/logger.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const logger = createLogger("report-store-live-ingest");

type PayloadType = "match" | "timeline" | "prematch";
type ErrorMode = "continue" | "throw";

type IngestOptions = {
  prisma: ExtendedPrismaClient;
  source: string;
  s3Key?: string;
  importedFromS3?: boolean;
  onError?: ErrorMode;
};

type MatchIngestOptions = IngestOptions & {
  match: RawMatch;
};

type TimelineIngestOptions = IngestOptions & {
  timeline: RawTimeline;
};

type PrematchIngestOptions = IngestOptions & {
  gameInfo: RawCurrentGameInfo;
  observedAt: Date;
};

export type ReportStoreIngestResult =
  | {
      status: "stored";
      factCount: number;
    }
  | {
      status: "failed";
      errorMessage: string;
    };

function importedFromS3(options: IngestOptions): boolean {
  return options.importedFromS3 ?? false;
}

function onError(options: IngestOptions): ErrorMode {
  return options.onError ?? "continue";
}

function recordSuccess(
  payloadType: PayloadType,
  source: string,
  factCount: number,
): void {
  reportStoreIngestTotal.inc({
    payload_type: payloadType,
    source,
    status: "stored",
  });
  if (factCount > 0) {
    reportStoreIngestFactsTotal.inc(
      {
        payload_type: payloadType,
        source,
      },
      factCount,
    );
  }
}

function recordFailure(
  payloadType: PayloadType,
  source: string,
  error: unknown,
): ReportStoreIngestResult {
  const errorMessage = getErrorMessage(error);
  reportStoreIngestTotal.inc({
    payload_type: payloadType,
    source,
    status: "failed",
  });
  logger.error(
    `[ReportStoreIngest] Failed to store ${payloadType} payload from ${source}:`,
    error,
  );
  Sentry.captureException(error, {
    tags: {
      source: "report-store-live-ingest",
      reportStoreSource: source,
      payloadType,
    },
  });
  return { status: "failed", errorMessage };
}

export async function recordMatchForReportStore(
  options: MatchIngestOptions,
): Promise<ReportStoreIngestResult> {
  try {
    const result = await upsertStoredMatchWithFacts(
      options.prisma,
      options.match,
      {
        ...(options.s3Key === undefined ? {} : { s3Key: options.s3Key }),
        importedFromS3: importedFromS3(options),
      },
    );
    recordSuccess("match", options.source, result.factCount);
    logger.info(
      `[ReportStoreIngest] Stored match ${options.match.metadata.matchId} from ${options.source} with ${result.factCount.toString()} fact(s)`,
    );
    return { status: "stored", factCount: result.factCount };
  } catch (error) {
    const failure = recordFailure("match", options.source, error);
    if (onError(options) === "throw") {
      throw error;
    }
    return failure;
  }
}

export async function recordTimelineForReportStore(
  options: TimelineIngestOptions,
): Promise<ReportStoreIngestResult> {
  try {
    await upsertStoredTimeline(options.prisma, options.timeline, {
      ...(options.s3Key === undefined ? {} : { s3Key: options.s3Key }),
      importedFromS3: importedFromS3(options),
    });
    recordSuccess("timeline", options.source, 0);
    logger.info(
      `[ReportStoreIngest] Stored timeline ${options.timeline.metadata.matchId} from ${options.source}`,
    );
    return { status: "stored", factCount: 0 };
  } catch (error) {
    const failure = recordFailure("timeline", options.source, error);
    if (onError(options) === "throw") {
      throw error;
    }
    return failure;
  }
}

export async function recordPrematchForReportStore(
  options: PrematchIngestOptions,
): Promise<ReportStoreIngestResult> {
  try {
    const result = await upsertStoredPrematchWithFacts(
      options.prisma,
      options.gameInfo,
      options.observedAt,
      {
        ...(options.s3Key === undefined ? {} : { s3Key: options.s3Key }),
        importedFromS3: importedFromS3(options),
      },
    );
    recordSuccess("prematch", options.source, result.factCount);
    logger.info(
      `[ReportStoreIngest] Stored prematch ${options.gameInfo.gameId.toString()} from ${options.source} with ${result.factCount.toString()} fact(s)`,
    );
    return { status: "stored", factCount: result.factCount };
  } catch (error) {
    const failure = recordFailure("prematch", options.source, error);
    if (onError(options) === "throw") {
      throw error;
    }
    return failure;
  }
}
