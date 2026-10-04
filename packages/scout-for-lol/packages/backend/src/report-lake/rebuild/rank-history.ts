import {
  ListObjectsV2Command,
  type S3Client,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { CachedLeaderboardSchema } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeCompactionSkippedTotal } from "#src/metrics/reports/report-lake.ts";
import { flattenCompetitionRankHistory } from "#src/report-lake/flatten.ts";
import type { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { stagingIdForCompetitionRankHistory } from "#src/report-lake/staging.ts";
import { s3StagingSourceKey } from "#src/report-lake/staging/generations.ts";
import { readRawObjectText } from "#src/report-store/s3-raw-source.ts";

const logger = createLogger("report-lake-rebuild-rank-history");
const REBUILD_S3_CONCURRENCY = 16;
const LEADERBOARD_PREFIX = "leaderboards/";
function sourceKey(key: string, rawText: string): string {
  return s3StagingSourceKey(
    key,
    createHash("sha256").update(rawText).digest("hex"),
  );
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
  foldedSources?: Set<string>;
  abortSignal?: AbortSignal;
}): Promise<number> {
  const { client, bucket, abortSignal } = options;
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
          return await readLeaderboard(client, bucket, key, abortSignal);
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
        writeSnapshot(options, snapshot);
      }
    }

    continuationToken = nextContinuation(response);
  } while (continuationToken !== undefined);

  return skipped;
}

function writeSnapshot(
  options: Parameters<typeof populateCompetitionRankHistoryFromS3>[0],
  snapshot: NonNullable<Awaited<ReturnType<typeof readLeaderboard>>>,
) {
  for (const row of flattenCompetitionRankHistory(snapshot.leaderboard))
    options.writer.write(row);
  options.foldedIds?.add(
    stagingIdForCompetitionRankHistory(
      snapshot.leaderboard.competitionId,
      new Date(snapshot.leaderboard.calculatedAt).toISOString().slice(0, 10),
    ),
  );
  options.foldedSources?.add(snapshot.source);
}

function nextContinuation(
  response: ListObjectsV2CommandOutput,
): string | undefined {
  if (response.IsTruncated !== true) return undefined;
  if (response.NextContinuationToken === undefined)
    throw new Error(
      "S3 leaderboard listing was truncated without a continuation token.",
    );
  return response.NextContinuationToken;
}
async function readLeaderboard(
  client: S3Client,
  bucket: string,
  key: string,
  abortSignal: AbortSignal | undefined,
) {
  // No remap here: leaderboard caches key on playerId/playerName and
  // carry no PUUIDs, verified against the stored objects themselves.
  const rawText = await readRawObjectText(
    client,
    bucket,
    key,
    abortSignal === undefined ? {} : { abortSignal },
  );
  const rawParsed: unknown = JSON.parse(rawText);
  const parsed = CachedLeaderboardSchema.safeParse(rawParsed);
  if (!parsed.success) {
    logger.warn(
      `Skipping S3 competition leaderboard ${key}: snapshot failed validation`,
      { issue: parsed.error.issues[0] },
    );
    return null;
  }
  return { leaderboard: parsed.data, source: sourceKey(key, rawText) };
}
