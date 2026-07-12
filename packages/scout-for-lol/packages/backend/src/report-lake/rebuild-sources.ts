import type { S3Client } from "@aws-sdk/client-s3";
import { RawCurrentGameInfoSchema, RawMatchSchema } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeCompactionSkippedTotal } from "#src/metrics/report-lake.ts";
import { flattenMatch, flattenPrematch } from "#src/report-lake/flatten.ts";
import type { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import {
  stagingIdForMatch,
  stagingIdForPrematch,
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

// --- Rebuild source: S3 (canonical) ---

export async function populateMatchesFromS3(
  client: S3Client,
  bucket: string,
  writer: NdjsonFileWriter,
  foldedIds: Set<string>,
): Promise<number> {
  let skipped = 0;
  const batch: string[] = [];
  const flush = async (): Promise<void> => {
    const parsedMatches = await Promise.all(
      batch.map(async (key) => {
        const rawParsed: unknown = JSON.parse(
          await readRawObjectText(client, bucket, key),
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
  };

  for await (const ref of enumerateRawObjects(client, bucket, MATCH_PREFIX)) {
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
  client: S3Client,
  bucket: string,
  writer: NdjsonFileWriter,
  foldedIds: Set<string>,
): Promise<number> {
  let skipped = 0;
  // observedAt is no longer a stored column — derive it from the S3 object's
  // LastModified (≈ detection time; the object was PUT in the same request).
  const batch: { key: string; observedAt: Date }[] = [];
  const flush = async (): Promise<void> => {
    const parsedPrematches = await Promise.all(
      batch.map(async (item) => {
        const rawParsed: unknown = JSON.parse(
          await readRawObjectText(client, bucket, item.key),
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
  };

  for await (const ref of enumerateRawObjects(
    client,
    bucket,
    PREMATCH_PREFIX,
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
