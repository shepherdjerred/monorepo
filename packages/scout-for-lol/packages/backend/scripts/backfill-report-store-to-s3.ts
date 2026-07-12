#!/usr/bin/env bun
/**
 * Completeness gate for the S3-canonical pivot (Part 3, PR-A).
 *
 * Before the destructive table drop (PR-B), S3 must hold 100% of the raw
 * match/prematch JSON that the SQLite Stored* tables currently hold — the
 * report lake will rebuild purely from S3. This script walks every
 * StoredMatch / StoredPrematch / StoredMatchTimeline row, checks whether its
 * deterministic S3 object exists, and uploads the row's rawJson if it's
 * missing. It reads rawJson (so it MUST run while the tables still exist) and
 * only writes to S3.
 *
 * Key derivation mirrors the live write paths exactly (storage/s3-helpers.ts,
 * storage/s3-prematch.ts):
 *   - match:    games/{gameCreationAt:yyyy/MM/dd}/{matchId}/match.json   (exact)
 *   - prematch: prematch/{createdAt:yyyy/MM/dd}/{gameId}/spectator-data.json,
 *               falling back to the observedAt date
 *   - timeline: games/{createdAt:yyyy/MM/dd}/{matchId}/timeline.json (upload
 *               date isn't reconstructable from the row — best-effort)
 * When a row already carries `s3Key` (imported-from-S3 rows), that is
 * authoritative and used directly.
 *
 * MATCHES + PREMATCH must reach 0 gaps (they are the lake inputs) — the script
 * exits non-zero otherwise. Timelines are archival-only (no lake reader) and
 * are best-effort.
 *
 * Usage:
 *   bun run scripts/backfill-report-store-to-s3.ts [--dry-run]
 *
 * Requires the backend pod env (DATABASE_URL, S3_BUCKET_NAME, AWS_*). Run via
 * `kubectl exec` into the scout-{beta,prod} backend pod.
 */
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  matchObjectKey,
  prematchObjectKey,
  putRawJsonObject,
  rawObjectExists,
  timelineObjectKey,
} from "#src/report-store/s3-raw-source.ts";

const logger = createLogger("backfill-report-store-to-s3");

const dryRun = Bun.argv.includes("--dry-run");
const PAGE_SIZE = 500;

function requireBucket(): string {
  const value = configuration.s3BucketName;
  if (value === undefined) {
    throw new Error(
      "S3_BUCKET_NAME is not configured — cannot backfill to S3.",
    );
  }
  return value;
}

const bucket = requireBucket();
const client = createS3Client();

type Tally = { present: number; uploaded: number; unrecoverable: number };

function newTally(): Tally {
  return { present: 0, uploaded: 0, unrecoverable: 0 };
}

// Ensure a single object is in S3, uploading rawJson if missing. `candidateKeys`
// are tried in order (first existing wins); the first is the canonical upload key.
async function ensureObject(
  candidateKeys: string[],
  rawJson: string,
  tally: Tally,
  label: string,
): Promise<void> {
  for (const key of candidateKeys) {
    if (await rawObjectExists(client, bucket, key)) {
      tally.present++;
      return;
    }
  }
  const uploadKey = candidateKeys[0];
  if (uploadKey === undefined) {
    tally.unrecoverable++;
    logger.error(`No candidate key for ${label}`);
    return;
  }
  if (dryRun) {
    logger.info(`[dry-run] would upload ${label} -> ${uploadKey}`);
    tally.uploaded++;
    return;
  }
  await putRawJsonObject(client, bucket, uploadKey, rawJson);
  tally.uploaded++;
}

async function backfillMatches(): Promise<Tally> {
  const tally = newTally();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.storedMatch.findMany({
      take: PAGE_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { matchId: cursor } }),
      orderBy: { matchId: "asc" },
      select: {
        matchId: true,
        gameCreationAt: true,
        s3Key: true,
        rawJson: true,
      },
    });
    if (page.length === 0) {
      break;
    }
    cursor = page.at(-1)?.matchId;
    for (const row of page) {
      const keys =
        row.s3Key === null
          ? [matchObjectKey(row.matchId, row.gameCreationAt)]
          : [row.s3Key];
      await ensureObject(keys, row.rawJson, tally, `match ${row.matchId}`);
    }
    logger.info(`matches progress`, { ...tally });
  }
  return tally;
}

async function backfillPrematch(): Promise<Tally> {
  const tally = newTally();
  let cursor: number | undefined;
  for (;;) {
    const page = await prisma.storedPrematch.findMany({
      take: PAGE_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: "asc" },
      select: {
        id: true,
        gameId: true,
        createdAt: true,
        observedAt: true,
        s3Key: true,
        rawJson: true,
      },
    });
    if (page.length === 0) {
      break;
    }
    cursor = page.at(-1)?.id;
    for (const row of page) {
      const keys =
        row.s3Key === null
          ? [
              prematchObjectKey(row.gameId, row.createdAt),
              prematchObjectKey(row.gameId, row.observedAt),
            ]
          : [row.s3Key];
      await ensureObject(keys, row.rawJson, tally, `prematch ${row.gameId}`);
    }
    logger.info(`prematch progress`, { ...tally });
  }
  return tally;
}

async function backfillTimelines(): Promise<Tally> {
  const tally = newTally();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.storedMatchTimeline.findMany({
      take: PAGE_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { matchId: cursor } }),
      orderBy: { matchId: "asc" },
      select: { matchId: true, createdAt: true, s3Key: true, rawJson: true },
    });
    if (page.length === 0) {
      break;
    }
    cursor = page.at(-1)?.matchId;
    for (const row of page) {
      // Timeline live keys use upload-date, not reconstructable from the row —
      // best-effort: use s3Key when present, else normalize to the createdAt
      // date going forward. Timelines have no lake reader.
      const keys =
        row.s3Key === null
          ? [timelineObjectKey(row.matchId, row.createdAt)]
          : [row.s3Key];
      await ensureObject(keys, row.rawJson, tally, `timeline ${row.matchId}`);
    }
    logger.info(`timeline progress`, { ...tally });
  }
  return tally;
}

const matches = await backfillMatches();
const prematch = await backfillPrematch();
const timelines = await backfillTimelines();
await prisma.$disconnect();

logger.info("Backfill complete", {
  dryRun,
  matches,
  prematch,
  timelines: { ...timelines, note: "best-effort (archival, no lake reader)" },
});

// Matches + prematch are the lake inputs — they must reach 0 unrecoverable gaps
// before the destructive drop (PR-B).
const lakeGaps = matches.unrecoverable + prematch.unrecoverable;
if (lakeGaps > 0) {
  logger.error(
    `❌ ${lakeGaps.toString()} unrecoverable match/prematch gap(s) — do NOT proceed to the table drop.`,
  );
  process.exit(1);
}
logger.info("✅ 0 match/prematch gaps — S3 is complete for the lake inputs.");
