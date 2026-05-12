#!/usr/bin/env bun
/**
 * Strip synthetic Iron IV / 0 LP entries from a competition's persisted
 * leaderboard snapshots in S3.
 *
 * Before this script's companion fix, `processHighestRank` fabricated an
 * Iron IV / 0 LP entry whenever rank data was missing (genuinely unranked
 * OR a failed Riot API fetch). Those fake entries were persisted into the
 * S3 snapshot and rendered as line-chart drops to 0. This script removes
 * any entry whose score deep-equals the exact synthetic shape, renumbers
 * surviving entries' `rank` field, and writes the snapshot back.
 *
 * Usage:
 *   bun run scripts/cleanup-iron-iv-entries.ts <competitionId> [--dry-run]
 *   bun run scripts/cleanup-iron-iv-entries.ts --all-active [--dry-run]
 *
 * Requires the same env as the backend pod (S3_BUCKET_NAME, AWS_* /
 * DATABASE_URL). Easiest to run via `kubectl exec` into a scout-{beta,prod}
 * backend pod.
 *
 * Idempotent: a second run finds nothing to remove.
 */
import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import {
  CachedLeaderboardSchema,
  type CachedLeaderboard,
  type CachedLeaderboardEntry,
  RankSchema,
  getCompetitionStatus,
} from "@scout-for-lol/data/index.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import { prisma } from "#src/database/index.ts";
import { getActiveCompetitions } from "#src/database/competition/queries.ts";
import configuration from "#src/configuration.ts";

const SYNTHETIC_UNRANKED_SCORE = {
  tier: "iron",
  division: 4,
  lp: 0,
  wins: 0,
  losses: 0,
} as const;

function isSyntheticUnranked(entry: CachedLeaderboardEntry): boolean {
  const rankResult = RankSchema.safeParse(entry.score);
  if (!rankResult.success) {
    return false;
  }
  const r = rankResult.data;
  return (
    r.tier === SYNTHETIC_UNRANKED_SCORE.tier &&
    r.division === SYNTHETIC_UNRANKED_SCORE.division &&
    r.lp === SYNTHETIC_UNRANKED_SCORE.lp &&
    r.wins === SYNTHETIC_UNRANKED_SCORE.wins &&
    r.losses === SYNTHETIC_UNRANKED_SCORE.losses
  );
}

const ListResponseSchema = z.object({
  Contents: z.array(z.object({ Key: z.string() })).optional(),
});

async function listSnapshotKeys(
  bucket: string,
  competitionId: number,
): Promise<string[]> {
  const client = createS3Client();
  const keys: string[] = [];
  let continuationToken: string | undefined = undefined;
  const prefix = `leaderboards/competition-${competitionId.toString()}/`;

  do {
    const cmd: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const response = await client.send(cmd);
    const parsed = ListResponseSchema.parse(response);
    for (const obj of parsed.Contents ?? []) {
      if (obj.Key.endsWith(".json")) {
        keys.push(obj.Key);
      }
    }
    const next = z
      .object({ NextContinuationToken: z.string().optional() })
      .parse(response).NextContinuationToken;
    continuationToken = next;
  } while (continuationToken !== undefined);

  return keys;
}

async function loadSnapshot(
  bucket: string,
  key: string,
): Promise<CachedLeaderboard> {
  const client = createS3Client();
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) {
    throw new Error(`No body for s3://${bucket}/${key}`);
  }
  const bodyString = await response.Body.transformToString();
  return CachedLeaderboardSchema.parse(JSON.parse(bodyString));
}

async function saveSnapshot(
  bucket: string,
  key: string,
  snapshot: CachedLeaderboard,
): Promise<void> {
  const client = createS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(snapshot, null, 2),
      ContentType: "application/json",
    }),
  );
}

type FileDiff = {
  key: string;
  before: number;
  after: number;
  removed: number;
};

async function cleanSnapshot(
  bucket: string,
  key: string,
  dryRun: boolean,
): Promise<FileDiff | null> {
  const snapshot = await loadSnapshot(bucket, key);
  const before = snapshot.entries.length;

  const kept = snapshot.entries.filter((e) => !isSyntheticUnranked(e));
  const removed = before - kept.length;
  if (removed === 0) {
    return null;
  }

  const renumbered = kept.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));

  const updated: CachedLeaderboard = {
    ...snapshot,
    entries: renumbered,
  };

  // Re-validate to be defensive about any drift in the schema.
  CachedLeaderboardSchema.parse(updated);

  if (!dryRun) {
    await saveSnapshot(bucket, key, updated);
  }

  return { key, before, after: kept.length, removed };
}

async function cleanCompetition(
  bucket: string,
  competitionId: number,
  dryRun: boolean,
): Promise<void> {
  const keys = await listSnapshotKeys(bucket, competitionId);
  if (keys.length === 0) {
    console.log(`competition ${competitionId.toString()}: no snapshots found`);
    return;
  }

  console.log(
    `competition ${competitionId.toString()}: scanning ${keys.length.toString()} objects under leaderboards/competition-${competitionId.toString()}/`,
  );

  let totalRemoved = 0;
  let filesChanged = 0;
  for (const key of keys) {
    const diff = await cleanSnapshot(bucket, key, dryRun);
    if (diff !== null) {
      console.log(
        `  ${dryRun ? "[dry-run] would update" : "updated"} ${diff.key}: ${diff.before.toString()} -> ${diff.after.toString()} entries (-${diff.removed.toString()} Iron-IV-0LP)`,
      );
      totalRemoved += diff.removed;
      filesChanged += 1;
    }
  }

  console.log(
    `competition ${competitionId.toString()}: ${dryRun ? "would change" : "changed"} ${filesChanged.toString()} files, ${dryRun ? "would remove" : "removed"} ${totalRemoved.toString()} synthetic entries`,
  );
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  allActive: boolean;
  competitionId: number | null;
} {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allActive = args.includes("--all-active");
  const positional = args.find((a) => !a.startsWith("--"));
  const competitionId = positional ? Number.parseInt(positional, 10) : null;

  if (allActive && competitionId !== null) {
    throw new Error("Pass either <competitionId> or --all-active, not both");
  }
  if (!allActive && competitionId === null) {
    throw new Error(
      "Usage: cleanup-iron-iv-entries.ts <competitionId> [--dry-run] | --all-active [--dry-run]",
    );
  }
  if (competitionId !== null && Number.isNaN(competitionId)) {
    throw new Error(`Invalid competition id: ${positional ?? "<missing>"}`);
  }
  return { dryRun, allActive, competitionId };
}

async function main(): Promise<void> {
  const { dryRun, allActive, competitionId } = parseArgs(process.argv);
  const bucket = configuration.s3BucketName;
  if (bucket === undefined || bucket === "") {
    throw new Error(
      "S3_BUCKET_NAME is not configured — cannot run cleanup against S3",
    );
  }

  console.log(
    `cleanup-iron-iv-entries: bucket=${bucket} dryRun=${dryRun.toString()} target=${allActive ? "all-active" : (competitionId ?? "<unknown>").toString()}`,
  );

  if (allActive) {
    const competitions = await getActiveCompetitions(prisma);
    const active = competitions.filter(
      (c) => getCompetitionStatus(c) === "ACTIVE",
    );
    console.log(
      `discovered ${active.length.toString()} ACTIVE competitions (of ${competitions.length.toString()} not-ended/not-cancelled)`,
    );
    for (const competition of active) {
      console.log(
        `\n=== competition ${competition.id.toString()} "${competition.title}" ===`,
      );
      await cleanCompetition(bucket, competition.id, dryRun);
    }
  } else if (competitionId !== null) {
    await cleanCompetition(bucket, competitionId, dryRun);
  }

  await prisma.$disconnect();
}

await main();
