import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

/**
 * Rows for the gap reads in `pipeline-gaps.ts`, written straight to the tables.
 *
 * Direct writes rather than the repositories, because these reads are about
 * combinations the repositories would never produce on purpose — a finished
 * match with no intent is the bug under test — and the schema's CHECK
 * constraints still refuse anything that could not be a real row.
 */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

const CHANNEL_ID = testChannelId("1");
const SERVER_ID = testGuildId("1");
const CREATOR_ID = testAccountId("1");

export type OwedMatch = {
  matchId: string;
  observedAt: Date;
  /** Last cursor advance; null leaves the match's one account unadvanced. */
  completedAt: Date | null;
  gameCreatedAt?: Date;
  policy?: "FULL" | "ARCHIVE_ONLY";
  owner?: "TEMPORAL_V2" | "LEGACY_V1";
  deliveryMode?: "live" | "silent-backfill";
  subscription?: {
    filters?: string | null;
    isMuted?: boolean;
    createdTime?: Date;
  } | null;
};

/**
 * One observed match with one tracked account and, unless told otherwise, one
 * unmuted, unfiltered subscription created an hour before the match ended —
 * a match the real resolver would owe a report to.
 */
export async function seedOwedMatch(
  prisma: ExtendedPrismaClient,
  match: OwedMatch,
): Promise<void> {
  const puuid = testPuuid(match.matchId);
  const earlier = new Date(match.observedAt.getTime() - 2 * HOUR_MS);
  await prisma.matchObservation.create({
    data: {
      riotMatchId: match.matchId,
      platformRoute: "NA1",
      processingPolicy: match.policy ?? "FULL",
      deliveryMode: match.deliveryMode ?? "live",
      pipelineOwner: match.owner ?? "TEMPORAL_V2",
      gameCreatedAt:
        match.gameCreatedAt ?? new Date(match.observedAt.getTime() - HOUR_MS),
      observedAt: match.observedAt,
    },
  });
  await prisma.matchTrackedAccount.create({
    data: {
      riotMatchId: match.matchId,
      puuid,
      cursorAdvancedAt: match.completedAt,
    },
  });
  if (match.subscription === null) return;
  const player = await prisma.player.create({
    data: {
      alias: match.matchId,
      serverId: SERVER_ID,
      creatorDiscordId: CREATOR_ID,
      createdTime: earlier,
      updatedTime: earlier,
      accounts: {
        create: {
          alias: match.matchId,
          puuid,
          region: "AMERICA_NORTH",
          serverId: SERVER_ID,
          creatorDiscordId: CREATOR_ID,
          createdTime: earlier,
          updatedTime: earlier,
        },
      },
    },
  });
  await prisma.subscription.create({
    data: {
      playerId: player.id,
      channelId: CHANNEL_ID,
      serverId: SERVER_ID,
      creatorDiscordId: CREATOR_ID,
      filters: match.subscription?.filters ?? null,
      isMuted: match.subscription?.isMuted ?? false,
      createdTime: match.subscription?.createdTime ?? earlier,
      updatedTime: earlier,
    },
  });
}

export async function seedIntent(
  prisma: ExtendedPrismaClient,
  args: {
    key: string;
    matchId: string;
    state: "pending" | "ready";
    createdAt: Date;
    kind?: "postmatch" | "prematch";
    recoveryBatchId?: string;
  },
): Promise<void> {
  await prisma.matchNotificationIntent.create({
    data: {
      intentKey: args.key,
      riotMatchId: args.matchId,
      kind: args.kind ?? "postmatch",
      originKind: args.recoveryBatchId === undefined ? "live" : "recovery",
      recoveryBatchId: args.recoveryBatchId ?? null,
      targetKind: "channel",
      targetId: CHANNEL_ID,
      state: args.state,
      freshnessDeadline: new Date(args.createdAt.getTime() + 3 * HOUR_MS),
      // A DB CHECK pins the envelope kind; the column is not free-form JSON.
      payload: JSON.stringify({
        kind: "notification-intent",
        version: 1,
        data: {},
      }),
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    },
  });
}

export async function seedRecoveryBatch(
  prisma: ExtendedPrismaClient,
  args: { id: string; policy: "normal" | "stale-private-only" | "no-external" },
): Promise<void> {
  const at = new Date();
  await prisma.matchRecoveryBatch.create({
    data: {
      recoveryBatchId: args.id,
      policy: args.policy,
      state: "planned",
      createdAt: at,
      updatedAt: at,
    },
  });
}

export async function seedReceipt(
  prisma: ExtendedPrismaClient,
  args: { matchId: string; kind: string },
): Promise<void> {
  await prisma.matchProcessingReceipt.create({
    data: {
      riotMatchId: args.matchId,
      kind: args.kind,
      version: 1,
      scopeKind: "global",
      scopeKey: "global",
      evidence: null,
      recordedAt: new Date(),
    },
  });
}

/** Empty every table the gap reads touch, children before parents. */
export async function clearGapTables(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.matchRecoveryBatch.deleteMany();
  await prisma.matchProcessingReceipt.deleteMany();
  await prisma.matchTrackedAccount.deleteMany();
  await prisma.matchObservation.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
}
