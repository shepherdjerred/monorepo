import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
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

export async function ensureMatchMvpContest(
  match: RawMatch,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchMvpRoster> {
  const matchId = MatchIdSchema.parse(match.metadata.matchId);
  const roster = freezeMatchMvpRoster(match);
  const existing = await prismaClient.matchMvpContest.findUnique({
    where: { matchId },
    select: { roster: true },
  });
  if (existing !== null) {
    return storedRosterMatching(matchId, existing.roster, roster);
  }
  try {
    await prismaClient.matchMvpContest.create({
      data: { matchId, roster },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const raced = await prismaClient.matchMvpContest.findUnique({
      where: { matchId },
      select: { roster: true },
    });
    if (raced === null) {
      throw new Error(
        `Match MVP contest ${matchId} vanished between a duplicate insert and its read-back`,
        { cause: error },
      );
    }
    return storedRosterMatching(matchId, raced.roster, roster);
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
  if (row === null) {
    return undefined;
  }
  return MatchMvpRosterSchema.parse(row.roster);
}

const ReportMessageIdsSchema = z.record(z.string(), z.string().min(1));

export type MatchMvpReportRef = {
  channelId: DiscordChannelId;
  messageId: string;
};

function parseReportMessageIds(value: unknown): Record<string, string> {
  if (value == null) {
    return {};
  }
  return ReportMessageIdsSchema.parse(value);
}

/**
 * Persist delivered Flex report message IDs on the contest so tally refresh
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
  const existing = await prismaClient.matchMvpContest.findUnique({
    where: { matchId },
    select: { reportMessageIds: true },
  });
  if (existing === null) {
    return;
  }
  const merged = {
    ...parseReportMessageIds(existing.reportMessageIds),
    ...Object.fromEntries(messageIds),
  };
  await prismaClient.matchMvpContest.update({
    where: { matchId },
    data: { reportMessageIds: merged },
  });
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
  nomineeAt(roster, input.nomineeIndex);
  const justification =
    input.justification === undefined ? null : input.justification;
  const row = await prismaClient.matchMvpVote.upsert({
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
      voterPuuid: input.voterPuuid,
      voterTeamId: input.voterTeamId,
      justification,
    },
    update: {
      nomineeIndex: input.nomineeIndex,
      voterPuuid: input.voterPuuid,
      voterTeamId: input.voterTeamId,
      justification,
    },
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
  if (trimmed.length > MVP_JUSTIFICATION_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
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
