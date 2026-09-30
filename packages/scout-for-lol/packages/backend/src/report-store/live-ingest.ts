import type {
  RawCurrentGameInfo,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data";
import * as Sentry from "@sentry/bun";
import { reportStoreIngestTotal } from "#src/metrics/reports/report-store.ts";
import {
  ingestMatch,
  ingestPrematch,
  ingestTimeline,
  type MatchIngestResult,
} from "#src/report-store/store.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-store-live-ingest");

type PayloadType = "match" | "timeline" | "prematch";

type MatchIngestOptions = {
  match: RawMatch;
  source: string;
  trackedPlayerAliases: string[];
};

type TimelineIngestOptions = {
  timeline: RawTimeline;
  source: string;
  trackedPlayerAliases: string[];
  /**
   * The match's `info.gameCreation`. It partitions the timeline's S3 key onto
   * the same day as the match payload, so the caller must supply the match's
   * own timestamp rather than letting the upload time stand in for it.
   */
  gameCreatedAt: Date;
};

type PrematchIngestOptions = {
  gameInfo: RawCurrentGameInfo;
  observedAt: Date;
  source: string;
  trackedPlayerAliases: string[];
};

function recordSuccess(payloadType: PayloadType, source: string): void {
  reportStoreIngestTotal.inc({
    payload_type: payloadType,
    source,
    status: "stored",
  });
}

function recordFailure(
  payloadType: PayloadType,
  source: string,
  error: unknown,
): void {
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
}

/**
 * Thin metric wrappers over the S3-authoritative ingest. On failure they record
 * the failure metric and RE-THROW — the caller (e.g. the polling cursor gate)
 * decides how to react. A swallowed failure would silently lose the match.
 *
 * The match wrapper passes the ingest's whole answer through, artifact
 * descriptor included, because the durable bridge above it stamps the
 * observation with that identity. Summarising the result here is what left the
 * observation's artifact columns NULL for every live match.
 */

export async function recordMatchForReportStore(
  options: MatchIngestOptions,
): Promise<MatchIngestResult> {
  try {
    const result = await ingestMatch(
      options.match,
      options.trackedPlayerAliases,
    );
    recordSuccess("match", options.source);
    logger.info(
      `[ReportStoreIngest] Stored match ${options.match.metadata.matchId} from ${options.source}`,
    );
    return result;
  } catch (error) {
    recordFailure("match", options.source, error);
    throw error;
  }
}

export async function recordTimelineForReportStore(
  options: TimelineIngestOptions,
): Promise<boolean> {
  try {
    const staged = await ingestTimeline(
      options.timeline,
      options.trackedPlayerAliases,
      options.gameCreatedAt,
    );
    recordSuccess("timeline", options.source);
    logger.info(
      `[ReportStoreIngest] Stored timeline ${options.timeline.metadata.matchId} from ${options.source}`,
    );
    return staged;
  } catch (error) {
    recordFailure("timeline", options.source, error);
    throw error;
  }
}

export async function recordPrematchForReportStore(
  options: PrematchIngestOptions,
): Promise<void> {
  try {
    await ingestPrematch(
      options.gameInfo,
      options.observedAt,
      options.trackedPlayerAliases,
    );
    recordSuccess("prematch", options.source);
    logger.info(
      `[ReportStoreIngest] Stored prematch ${options.gameInfo.gameId.toString()} from ${options.source}`,
    );
  } catch (error) {
    recordFailure("prematch", options.source, error);
    throw error;
  }
}
