import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import {
  CachedLeaderboardSchema,
  BucksPredictionObservationSchema,
  RawCurrentGameInfoSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeCompactionSkippedTotal } from "#src/metrics/report-lake.ts";
import {
  flattenCompetitionRankHistory,
  flattenMatch,
  flattenPrematch,
  flattenPredictionObservation,
} from "#src/report-lake/flatten.ts";
import type { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import {
  stagingIdForCompetitionRankHistory,
  stagingIdForMatch,
  stagingIdForPrematch,
  stagingIdForPredictionObservation,
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

export async function populateMatchesFromS3(
  options: RebuildSourceOptions,
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

export async function populatePredictionObservationsFromS3(
  options: RebuildSourceOptions,
): Promise<number> {
  const { client, bucket, writer, foldedIds } = options;
  let skipped = 0;
  const batch: string[] = [];
  const flush = async (): Promise<void> => {
    const observations = await Promise.all(
      batch.map(async (key) => {
        const rawParsed: unknown = JSON.parse(
          await readRawObjectText(client, bucket, key, options),
        );
        const parsed = BucksPredictionObservationSchema.safeParse(rawParsed);
        if (!parsed.success) {
          logger.warn(
            `Skipping S3 prediction observation ${key}: JSON failed validation`,
            { issue: parsed.error.issues[0] },
          );
          return null;
        }
        return parsed.data;
      }),
    );
    batch.length = 0;
    for (const observation of observations) {
      if (observation === null) {
        skipped += 1;
        reportLakeCompactionSkippedTotal.inc({
          table: "prediction_observations",
        });
        continue;
      }
      writer.write(flattenPredictionObservation(observation));
      foldedIds.add(stagingIdForPredictionObservation(observation.matchId));
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
    if (classifyRawObjectKey(ref.key) !== "prediction_observation") {
      continue;
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
