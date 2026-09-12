import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import {
  CachedLeaderboardSchema,
  RawCurrentGameInfoSchema,
  RawMatchSchema,
  RawTimelineSchema,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeCompactionSkippedTotal } from "#src/metrics/reports/report-lake.ts";
import {
  flattenCompetitionRankHistory,
  flattenMatch,
  flattenMatchTeamBans,
  flattenMatchTeams,
  flattenPrematch,
} from "#src/report-lake/flatten.ts";
import { flattenTimeline } from "#src/report-lake/flatten-timeline.ts";
import type { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import {
  stagingIdForCompetitionRankHistory,
  stagingIdForMatch,
  stagingIdForPrematch,
  stagingIdForTimeline,
} from "#src/report-lake/staging.ts";
import {
  MATCH_PREFIX,
  PREMATCH_PREFIX,
  classifyRawObjectKey,
  enumerateRawObjects,
  readRawObjectText,
} from "#src/report-store/s3-raw-source.ts";

const logger = createLogger("report-lake-rebuild-sources");

// Bounded in-flight S3 GETs during a rebuild. Fetch+parse+flatten runs
// concurrently; writes are funnelled serially into the single NDJSON writer.
const REBUILD_S3_CONCURRENCY = 16;
const LEADERBOARD_PREFIX = "leaderboards/";

// --- Rebuild source: S3 (canonical) ---

type RebuildSourceOptions = {
  client: S3Client;
  bucket: string;
  writer: NdjsonFileWriter;
  foldedIds: Set<string>;
  abortSignal?: AbortSignal;
  onProgress?: (progress: {
    files: number;
    rows: number;
    skipped: number;
  }) => void;
};

type MatchRebuildSourceOptions = RebuildSourceOptions & {
  teamWriter: NdjsonFileWriter;
  teamBanWriter: NdjsonFileWriter;
};

export async function populateMatchesFromS3(
  options: MatchRebuildSourceOptions,
): Promise<number> {
  const { client, bucket, writer, foldedIds } = options;
  let skipped = 0;
  const batch: string[] = [];
  const flush = async (): Promise<void> => {
    const parsedMatches = await Promise.all(
      batch.map(async (key) => {
        const rawParsed: unknown = JSON.parse(
          await readRawObjectText(client, bucket, key, options),
        );
        const parsed = RawMatchSchema.safeParse(rawParsed);
        if (!parsed.success) {
          logger.warn(`Skipping S3 match ${key}: rawJson failed validation`, {
            issue: parsed.error.issues[0],
          });
          return null;
        }
        return parsed.data;
      }),
    );
    batch.length = 0;
    for (const match of parsedMatches) {
      if (match === null) {
        skipped += 1;
        reportLakeCompactionSkippedTotal.inc({ table: "matches" });
        continue;
      }
      for (const row of flattenMatch(match)) {
        writer.write(row);
      }
      for (const row of flattenMatchTeams(match)) {
        options.teamWriter.write(row);
      }
      for (const row of flattenMatchTeamBans(match)) {
        options.teamBanWriter.write(row);
      }
      foldedIds.add(stagingIdForMatch(match.metadata.matchId));
    }
    options.onProgress?.({
      files: foldedIds.size + skipped,
      rows: writer.rows,
      skipped,
    });
  };

  for await (const ref of enumerateRawObjects(
    client,
    bucket,
    MATCH_PREFIX,
    options,
  )) {
    if (classifyRawObjectKey(ref.key) !== "match") {
      continue; // skip timeline.json etc. under games/
    }
    batch.push(ref.key);
    if (batch.length >= REBUILD_S3_CONCURRENCY) {
      await flush();
    }
  }
  if (batch.length > 0) {
    await flush();
  }
  return skipped;
}

type TimelineRebuildWriters = {
  events: NdjsonFileWriter;
  eventParticipants: NdjsonFileWriter;
  participantFrames: NdjsonFileWriter;
  coverage: NdjsonFileWriter;
};

function timelineWriterRows(writers: TimelineRebuildWriters): number {
  return (
    writers.events.rows +
    writers.eventParticipants.rows +
    writers.participantFrames.rows +
    writers.coverage.rows
  );
}

/**
 * TIMELINE PARTITION CUTOVER (2026-09-12). Timeline objects written before this
 * date are keyed by their UPLOAD day; those written after are keyed by the
 * match's `gameCreation` day, so that every asset for a game shares one prefix
 * (see `storage/s3.ts`). Both layouts sit under `games/yyyy/MM/dd/{matchId}/`
 * and this rebuild enumerates that whole prefix, classifying by the
 * `/timeline.json` suffix and taking match identity from the parsed payload —
 * never from the key. Reading both layouts therefore needed no listing change.
 * What it DID need is deduplication, because a match can have a surviving
 * object in each layout; see {@link dedupeTimelineCandidates}.
 *
 * `lastModified` is the accurate observation time and is preferred whenever S3
 * supplies it. The key-derived fallback is the day the object was filed, which
 * means the upload day under the old layout and the game day under the new one.
 * Both are day-resolution approximations of when the timeline was seen, which
 * is all this value is used for.
 */
function timelineObservedAt(key: string, lastModified: Date | undefined): Date {
  if (lastModified !== undefined) return lastModified;
  const keyDate = /games\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(key);
  const year = keyDate?.at(1);
  const month = keyDate?.at(2);
  const day = keyDate?.at(3);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Timeline object key has no stable date: ${key}`);
  }
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}

/**
 * The match id segment of `games/yyyy/MM/dd/{matchId}/timeline.json`.
 *
 * Used only to GROUP candidate objects before fetching them, never to decide
 * what a payload is; the winning object's identity still comes from its parsed
 * `metadata.matchId`.
 */
function timelineKeyMatchId(key: string): string {
  return key.split("/").at(-2) ?? key;
}

/**
 * Pick one object per match from the cutover's two layouts.
 *
 * The partition cutover means a match whose timeline was written before it and
 * retried after it has TWO surviving objects — one under the upload day, one
 * under the game day — and both are valid, parseable timelines for the same
 * match. Replaying both would emit two sets of rows for one match, and which
 * set a query saw would depend on file order. Newest wins: a retry exists
 * because something about the first attempt was unsatisfactory.
 *
 * Ranking uses the same instant as {@link timelineObservedAt}, so an object S3
 * gives no `LastModified` for is ranked by the day its key files it under
 * rather than being dropped. Ties break on the key so the result is a total
 * order and the rebuild is reproducible.
 */
function dedupeTimelineCandidates(
  candidates: readonly { key: string; observedAt: Date }[],
): { key: string; observedAt: Date }[] {
  const newestByMatch = new Map<string, { key: string; observedAt: Date }>();
  for (const candidate of candidates) {
    const matchId = timelineKeyMatchId(candidate.key);
    const existing = newestByMatch.get(matchId);
    if (
      existing === undefined ||
      candidate.observedAt.getTime() > existing.observedAt.getTime() ||
      (candidate.observedAt.getTime() === existing.observedAt.getTime() &&
        candidate.key > existing.key)
    ) {
      newestByMatch.set(matchId, candidate);
    }
  }
  return [...newestByMatch.values()].toSorted(
    (left, right) =>
      right.observedAt.getTime() - left.observedAt.getTime() ||
      left.key.localeCompare(right.key),
  );
}

/** Replay only already-retained timeline objects into the normalized lake. */
export async function populateTimelinesFromS3(options: {
  client: S3Client;
  bucket: string;
  writers: TimelineRebuildWriters;
  foldedIds: Set<string>;
  abortSignal?: AbortSignal;
  onProgress?: (progress: {
    files: number;
    rows: number;
    skipped: number;
  }) => void;
}): Promise<number> {
  let skipped = 0;
  const emitted = new Set<string>();
  const batch: { key: string; observedAt: Date }[] = [];
  const flush = async (): Promise<void> => {
    const timelines = await Promise.all(
      batch.map(async (item) => {
        const rawParsed: unknown = JSON.parse(
          await readRawObjectText(
            options.client,
            options.bucket,
            item.key,
            options,
          ),
        );
        const parsed = RawTimelineSchema.safeParse(rawParsed);
        if (!parsed.success) {
          logger.warn(
            `Skipping S3 timeline ${item.key}: rawJson failed validation`,
            { issue: parsed.error.issues[0] },
          );
          return null;
        }
        return { timeline: parsed.data, observedAt: item.observedAt };
      }),
    );
    batch.length = 0;
    for (const result of timelines) {
      if (result === null) {
        skipped += 1;
        reportLakeCompactionSkippedTotal.inc({ table: "timeline_coverage" });
        continue;
      }
      // Second line of defence behind the key-level dedupe: two objects under
      // different key match ids can still parse to the same payload match id.
      // Candidates arrive newest-first, so the first one seen is the winner.
      if (emitted.has(result.timeline.metadata.matchId)) continue;
      emitted.add(result.timeline.metadata.matchId);
      const flattened = flattenTimeline(result.timeline, result.observedAt);
      for (const row of flattened.events) options.writers.events.write(row);
      for (const row of flattened.eventParticipants) {
        options.writers.eventParticipants.write(row);
      }
      for (const row of flattened.participantFrames) {
        options.writers.participantFrames.write(row);
      }
      for (const row of flattened.coverage) options.writers.coverage.write(row);
      options.foldedIds.add(
        stagingIdForTimeline(result.timeline.metadata.matchId),
      );
    }
    options.onProgress?.({
      files: options.foldedIds.size + skipped,
      rows: timelineWriterRows(options.writers),
      skipped,
    });
  };

  // Enumerate the whole prefix before fetching anything. Deduping needs to see
  // every candidate for a match, and the listing is metadata-only — it is the
  // GETs that cost, and this is what stops us paying for a loser twice.
  const candidates: { key: string; observedAt: Date }[] = [];
  for await (const ref of enumerateRawObjects(
    options.client,
    options.bucket,
    MATCH_PREFIX,
    options,
  )) {
    if (classifyRawObjectKey(ref.key) !== "timeline") continue;
    candidates.push({
      key: ref.key,
      observedAt: timelineObservedAt(ref.key, ref.lastModified),
    });
  }

  for (const candidate of dedupeTimelineCandidates(candidates)) {
    batch.push(candidate);
    if (batch.length >= REBUILD_S3_CONCURRENCY) await flush();
  }
  if (batch.length > 0) await flush();
  return skipped;
}

export async function populatePrematchFromS3(
  options: RebuildSourceOptions,
): Promise<number> {
  const { client, bucket, writer, foldedIds } = options;
  let skipped = 0;
  // observedAt is no longer a stored column — derive it from the S3 object's
  // LastModified (≈ detection time; the object was PUT in the same request).
  const batch: { key: string; observedAt: Date }[] = [];
  const flush = async (): Promise<void> => {
    const parsedPrematches = await Promise.all(
      batch.map(async (item) => {
        const rawParsed: unknown = JSON.parse(
          await readRawObjectText(client, bucket, item.key, options),
        );
        const parsed = RawCurrentGameInfoSchema.safeParse(rawParsed);
        if (!parsed.success) {
          logger.warn(
            `Skipping S3 prematch ${item.key}: rawJson failed validation`,
            { issue: parsed.error.issues[0] },
          );
          return null;
        }
        return { gameInfo: parsed.data, observedAt: item.observedAt };
      }),
    );
    batch.length = 0;
    for (const result of parsedPrematches) {
      if (result === null) {
        skipped += 1;
        reportLakeCompactionSkippedTotal.inc({ table: "prematch" });
        continue;
      }
      for (const row of flattenPrematch(result.gameInfo, result.observedAt)) {
        writer.write(row);
      }
      foldedIds.add(
        stagingIdForPrematch(
          `${result.gameInfo.platformId}:${result.gameInfo.gameId.toString()}`,
        ),
      );
    }
    options.onProgress?.({
      files: foldedIds.size + skipped,
      rows: writer.rows,
      skipped,
    });
  };

  for await (const ref of enumerateRawObjects(
    client,
    bucket,
    PREMATCH_PREFIX,
    options,
  )) {
    if (classifyRawObjectKey(ref.key) !== "prematch") {
      continue;
    }
    batch.push({ key: ref.key, observedAt: ref.lastModified ?? new Date() });
    if (batch.length >= REBUILD_S3_CONCURRENCY) {
      await flush();
    }
  }
  if (batch.length > 0) {
    await flush();
  }
  return skipped;
}

/**
 * Materialize the authoritative daily leaderboard snapshots into a
 * language-neutral lake table. Current leaderboard objects and chart images
 * are deliberately excluded; only versioned historical JSON is replayed.
 */
export async function populateCompetitionRankHistoryFromS3(options: {
  client: S3Client;
  bucket: string;
  writer: NdjsonFileWriter;
  foldedIds?: Set<string>;
  abortSignal?: AbortSignal;
}): Promise<number> {
  const { client, bucket, writer, foldedIds, abortSignal } = options;
  let continuationToken: string | undefined;
  let skipped = 0;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: LEADERBOARD_PREFIX,
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
      abortSignal === undefined ? {} : { abortSignal },
    );
    const keys = (response.Contents ?? [])
      .flatMap((object) => (object.Key === undefined ? [] : [object.Key]))
      .filter((key) =>
        /^leaderboards\/competition-\d+\/snapshots\/\d{4}-\d{2}-\d{2}\.json$/.test(
          key,
        ),
      );

    for (
      let offset = 0;
      offset < keys.length;
      offset += REBUILD_S3_CONCURRENCY
    ) {
      const chunk = keys.slice(offset, offset + REBUILD_S3_CONCURRENCY);
      const snapshots = await Promise.all(
        chunk.map(async (key) => {
          const rawParsed: unknown = JSON.parse(
            await readRawObjectText(
              client,
              bucket,
              key,
              abortSignal === undefined ? {} : { abortSignal },
            ),
          );
          const parsed = CachedLeaderboardSchema.safeParse(rawParsed);
          if (!parsed.success) {
            logger.warn(
              `Skipping S3 competition leaderboard ${key}: snapshot failed validation`,
              { issue: parsed.error.issues[0] },
            );
            return null;
          }
          return parsed.data;
        }),
      );
      for (const snapshot of snapshots) {
        if (snapshot === null) {
          skipped += 1;
          reportLakeCompactionSkippedTotal.inc({
            table: "competition_rank_history",
          });
          continue;
        }
        for (const row of flattenCompetitionRankHistory(snapshot)) {
          writer.write(row);
        }
        foldedIds?.add(
          stagingIdForCompetitionRankHistory(
            snapshot.competitionId,
            new Date(snapshot.calculatedAt).toISOString().slice(0, 10),
          ),
        );
      }
    }

    if (response.IsTruncated === true) {
      if (response.NextContinuationToken === undefined) {
        throw new Error(
          "S3 leaderboard listing was truncated without a continuation token.",
        );
      }
      continuationToken = response.NextContinuationToken;
    } else {
      continuationToken = undefined;
    }
  } while (continuationToken !== undefined);

  return skipped;
}
