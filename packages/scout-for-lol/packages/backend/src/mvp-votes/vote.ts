import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
  resolveQueueTypeFromGame,
  RiotTeamIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type LeaguePuuid,
  type MatchId,
  type RawMatch,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { Prisma } from "#generated/prisma/client/index.js";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  MatchMvpCategorySchema,
  type MatchMvpCategory,
} from "#src/mvp-votes/custom-id.ts";
import { MVP_JUSTIFICATION_MAX_LENGTH } from "#src/mvp-votes/copy.ts";
import {
  MatchMvpRosterSchema,
  freezeMatchMvpRoster,
  nomineeAt,
  type MatchMvpRoster,
} from "#src/mvp-votes/roster.ts";

export type StoredMatchMvpVote = {
  matchId: MatchId;
  serverId: DiscordGuildId;
  voterDiscordId: DiscordAccountId;
  category: MatchMvpCategory;
  nomineeIndex: number;
  nomineePuuid: LeaguePuuid | null;
  nomineeTeamId: RiotTeamId | null;
  voterPuuid: LeaguePuuid;
  voterTeamId: RiotTeamId;
  justification: string | null;
};

const StoredMatchMvpVoteRowSchema = z.object({
  matchId: MatchIdSchema,
  serverId: DiscordGuildIdSchema,
  voterDiscordId: DiscordAccountIdSchema,
  category: MatchMvpCategorySchema,
  nomineeIndex: z.number().int().min(0).max(9),
  nomineePuuid: LeaguePuuidSchema.nullable(),
  nomineeTeamId: RiotTeamIdSchema.nullable(),
  voterPuuid: LeaguePuuidSchema,
  voterTeamId: RiotTeamIdSchema,
  justification: z.string().max(MVP_JUSTIFICATION_MAX_LENGTH).nullable(),
});

function parseStoredVote(row: unknown): StoredMatchMvpVote {
  return StoredMatchMvpVoteRowSchema.parse(row);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function storedRosterMatching(
  matchId: MatchId,
  storedJson: unknown,
  roster: MatchMvpRoster,
): MatchMvpRoster {
  const stored = MatchMvpRosterSchema.parse(storedJson);
  if (!Bun.deepEquals(stored, roster)) {
    throw new Error(
      `Match MVP contest ${matchId} already froze a different roster`,
    );
  }
  return stored;
}

type ContestQueryColumns = {
  gameCreationAt: Date | null;
  queueType: string | null;
};

async function backfillContestQueryColumns(
  matchId: MatchId,
  stored: ContestQueryColumns,
  next: { gameCreationAt: Date; queueType: string | null },
  prismaClient: ExtendedPrismaClient,
): Promise<void> {
  if (stored.gameCreationAt !== null && stored.queueType !== null) {
    return;
  }
  await prismaClient.matchMvpContest.update({
    where: { matchId },
    data: {
      gameCreationAt: stored.gameCreationAt ?? next.gameCreationAt,
      queueType: stored.queueType ?? next.queueType,
    },
  });
}

export async function ensureMatchMvpContest(
  match: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchMvpRoster> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const roster = freezeMatchMvpRoster(match);
  const gameCreationAt = new Date(match.info.gameCreation);
  const queueType = resolveQueueTypeFromGame(
    match.info.queueId,
    match.info.gameMode,
    match.info.gameType,
  );
  const queryColumns = { gameCreationAt, queueType: queueType ?? null };
  const existing = await prismaClient.matchMvpContest.findUnique({
    where: { matchId },
    select: { roster: true, gameCreationAt: true, queueType: true },
  });
  if (existing !== null) {
    const stored = storedRosterMatching(matchId, existing.roster, roster);
    await backfillContestQueryColumns(
      matchId,
      existing,
      queryColumns,
      prismaClient,
    );
    return stored;
  }
  try {
    await prismaClient.matchMvpContest.create({
      data: {
        matchId,
        roster,
        gameCreationAt,
        queueType: queueType ?? null,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const raced = await prismaClient.matchMvpContest.findUnique({
      where: { matchId },
      select: { roster: true, gameCreationAt: true, queueType: true },
    });
    if (raced === null) {
      throw new Error(
        `Match MVP contest ${matchId} vanished between a duplicate insert and its read-back`,
        { cause: error },
      );
    }
    const stored = storedRosterMatching(matchId, raced.roster, roster);
    await backfillContestQueryColumns(
      matchId,
      raced,
      queryColumns,
      prismaClient,
    );
    return stored;
  }
  return roster;
}

export async function loadMatchMvpRoster(
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchMvpRoster | undefined> {
  const row = await prismaClient.matchMvpContest.findUnique({
    where: { matchId },
    select: { roster: true },
  });
  return row === null ? undefined : MatchMvpRosterSchema.parse(row.roster);
}

const ReportMessageIdsSchema = z.record(z.string(), z.string().min(1));

export type MatchMvpReportRef = {
  channelId: DiscordChannelId;
  messageId: string;
};

function parseReportMessageIds(value: unknown): Record<string, string> {
  return value == null ? {} : ReportMessageIdsSchema.parse(value);
}

/**
 * Persist delivered report message IDs on the contest so tally refresh
 * still has a target after ActiveGame rows expire. No-op when this match has
 * no contest (no vote furniture).
 */
export async function recordMatchMvpReportRefs(
  matchId: MatchId,
  messageIds: ReadonlyMap<string, string>,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  if (messageIds.size === 0) {
    return;
  }
  const next = ReportMessageIdsSchema.parse(Object.fromEntries(messageIds));
  // Delivery and vote-button events can record different channels at once.
  // Merge under PostgreSQL's row lock so neither read/modify/write loses refs.
  const updated = await prismaClient.$transaction(async (tx) => {
    const changed = await tx.$executeRaw`
      UPDATE "MatchMvpContest"
      SET "reportMessageIds" = COALESCE("reportMessageIds", '{}'::jsonb) || ${JSON.stringify(next)}::jsonb
      WHERE "matchId" = ${matchId}
        AND ("reportMessageIds" IS NULL OR jsonb_typeof("reportMessageIds") = 'object')
        AND NOT (COALESCE("reportMessageIds", '{}'::jsonb) @> ${JSON.stringify(next)}::jsonb)
    `;
    if (changed > 0) {
      // A late delivery target must reopen a completed tally atomically with
      // the new ref, even if the process dies immediately after this write.
      await tx.matchMvpTallyRefresh.updateMany({
        where: { matchId },
        data: {
          pending: true,
          nextAttemptAt: new Date(),
          requeueGeneration: { increment: 1 },
          targetProgress: {},
        },
      });
    }
    return changed;
  });
  if (updated > 0) return;
  const existing = await prismaClient.matchMvpContest.findUnique({
    where: { matchId },
    select: { reportMessageIds: true },
  });
  if (existing === null) return;
  const stored = parseReportMessageIds(existing.reportMessageIds);
  if (
    Object.entries(next).every(
      ([channelId, messageId]) => stored[channelId] === messageId,
    )
  ) {
    return;
  }
  throw new Error(`Match MVP contest ${matchId} report refs were not updated`);
}

export async function listMatchMvpReportRefs(
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchMvpReportRef[]> {
  const row = await prismaClient.matchMvpContest.findUnique({
    where: { matchId },
    select: { reportMessageIds: true },
  });
  if (row === null) {
    return [];
  }
  return Object.entries(parseReportMessageIds(row.reportMessageIds)).map(
    ([channelId, messageId]) => ({
      channelId: DiscordChannelIdSchema.parse(channelId),
      messageId,
    }),
  );
}

/** Keep guild ownership even when Discord can no longer resolve the channel. */
export async function rememberMatchMvpReportTarget(
  input: MatchMvpReportRef & {
    matchId: MatchId;
    serverId: DiscordGuildId;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  await prismaClient.matchMvpReportTarget.createMany({
    data: [input],
    skipDuplicates: true,
  });
  const standing = await prismaClient.matchMvpReportTarget.findUnique({
    where: {
      matchId_channelId_messageId: {
        matchId: input.matchId,
        channelId: input.channelId,
        messageId: input.messageId,
      },
    },
    select: { serverId: true },
  });
  if (standing?.serverId !== input.serverId) {
    throw new Error(
      `MVP report target ${input.channelId} for ${input.matchId} has conflicting guild ownership`,
    );
  }
}

/** A vote button supplies the report's guild before a later REST lookup can fail. */
export async function recordMatchMvpOwnedReportRef(
  input: MatchMvpReportRef & {
    matchId: MatchId;
    serverId: DiscordGuildId;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  await rememberMatchMvpReportTarget(input, prismaClient);
  await recordMatchMvpReportRefs(
    input.matchId,
    new Map([[input.channelId, input.messageId]]),
    prismaClient,
  );
}

export async function upsertMatchMvpVote(
  input: {
    matchId: MatchId;
    serverId: DiscordGuildId;
    voterDiscordId: DiscordAccountId;
    category: MatchMvpCategory;
    nomineeIndex: number;
    voterPuuid: LeaguePuuid;
    voterTeamId: RiotTeamId;
    justification?: string | null;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<StoredMatchMvpVote> {
  const roster = await loadMatchMvpRoster(input.matchId, prismaClient);
  if (roster === undefined) {
    throw new Error(
      `Match MVP contest ${input.matchId} is missing; a vote cannot be recorded without a frozen roster`,
    );
  }
  // Ally/enemy are two independent ballots, not team filters: a voter may
  // name any of the ten participants on either ballot. The public tally
  // groups by the nominee's side, so two ballots for the same person both
  // count there.
  const nominee = nomineeAt(roster, input.nomineeIndex);
  const justification =
    input.justification === undefined ? null : input.justification;
  const row = await prismaClient.$transaction(async (tx) => {
    const stored = await tx.matchMvpVote.upsert({
      where: {
        matchId_serverId_voterDiscordId_category: {
          matchId: input.matchId,
          serverId: input.serverId,
          voterDiscordId: input.voterDiscordId,
          category: input.category,
        },
      },
      create: {
        matchId: input.matchId,
        serverId: input.serverId,
        voterDiscordId: input.voterDiscordId,
        category: input.category,
        nomineeIndex: input.nomineeIndex,
        nomineePuuid: nominee.puuid,
        nomineeTeamId: nominee.teamId,
        voterPuuid: input.voterPuuid,
        voterTeamId: input.voterTeamId,
        justification,
      },
      update: {
        nomineeIndex: input.nomineeIndex,
        nomineePuuid: nominee.puuid,
        nomineeTeamId: nominee.teamId,
        voterPuuid: input.voterPuuid,
        voterTeamId: input.voterTeamId,
        justification,
      },
    });
    await tx.matchMvpTallyRefresh.upsert({
      where: {
        matchId_serverId: {
          matchId: input.matchId,
          serverId: input.serverId,
        },
      },
      create: {
        matchId: input.matchId,
        serverId: input.serverId,
        desiredRevision: 1,
      },
      update: {
        desiredRevision: { increment: 1 },
        targetProgress: {},
        pending: true,
        nextAttemptAt: new Date(),
        requestedAt: new Date(),
        attemptCount: 0,
        lastErrorCode: null,
      },
    });
    return stored;
  });
  return parseStoredVote(row);
}

export function parseJustification(
  raw: string,
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  return trimmed.length > MVP_JUSTIFICATION_MAX_LENGTH
    ? { ok: false }
    : { ok: true, value: trimmed };
}

export async function setMatchMvpJustification(
  input: {
    matchId: MatchId;
    serverId: DiscordGuildId;
    voterDiscordId: DiscordAccountId;
    category: MatchMvpCategory;
    justification: string | null;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<StoredMatchMvpVote> {
  const row = await prismaClient.matchMvpVote.update({
    where: {
      matchId_serverId_voterDiscordId_category: {
        matchId: input.matchId,
        serverId: input.serverId,
        voterDiscordId: input.voterDiscordId,
        category: input.category,
      },
    },
    data: { justification: input.justification },
  });
  return parseStoredVote(row);
}

export async function listMatchMvpVotes(
  input: { matchId: MatchId; serverId: DiscordGuildId },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<StoredMatchMvpVote[]> {
  const rows = await prismaClient.matchMvpVote.findMany({
    where: { matchId: input.matchId, serverId: input.serverId },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => parseStoredVote(row));
}
