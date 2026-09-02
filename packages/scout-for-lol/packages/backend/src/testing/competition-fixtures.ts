import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createCompetition } from "#src/database/competition/queries.ts";
import type { addParticipant } from "#src/database/competition/participants.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import type {
  CompetitionCriteria,
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
  ParticipantStatus,
  Region,
} from "@scout-for-lol/data";

const fixtureServerId = testGuildId("123456789012345678");
const fixtureOwnerId = testAccountId("987654321098765432");

type CompetitionFixtureOptions = {
  serverId?: DiscordGuildId;
  ownerId?: DiscordAccountId;
  startDate?: Date;
  endDate?: Date;
  criteria?: CompetitionCriteria;
  visibility?: "OPEN" | "INVITE_ONLY" | "SERVER_WIDE";
  maxParticipants?: number;
  title?: string;
  description?: string;
  cancelled?: boolean;
};

type PlayerFixtureOptions = {
  alias: string;
  discordId?: DiscordAccountId | null;
  serverId?: DiscordGuildId;
  creatorDiscordId?: DiscordAccountId;
  puuid?: LeaguePuuid;
  region?: Region;
};

export async function createCompetitionFixture(
  prisma: ExtendedPrismaClient,
  options: CompetitionFixtureOptions = {},
) {
  const startDate = options.startDate ?? new Date();
  const competition = await createCompetition(prisma, {
    serverId: options.serverId ?? fixtureServerId,
    ownerId: options.ownerId ?? fixtureOwnerId,
    channelId: testChannelId("111222333444555666"),
    title: options.title ?? "Test Competition",
    description: options.description ?? "Test Description",
    visibility: options.visibility ?? "OPEN",
    maxParticipants: options.maxParticipants ?? 50,
    dates: {
      type: "FIXED_DATES",
      startDate,
      endDate:
        options.endDate ?? new Date(startDate.getTime() + 7 * 86_400_000),
    },
    criteria: options.criteria ?? {
      type: "MOST_GAMES_PLAYED",
      queues: ["solo"],
    },
  });
  if (options.cancelled === true) {
    return prisma.competition.update({
      where: { id: competition.id },
      data: { isCancelled: true },
    });
  }
  return competition;
}

export async function createCompetitionPlayerFixture(
  prisma: ExtendedPrismaClient,
  options: PlayerFixtureOptions,
) {
  const now = new Date();
  const serverId = options.serverId ?? fixtureServerId;
  const creatorDiscordId = options.creatorDiscordId ?? fixtureOwnerId;
  const basePlayer = {
    alias: options.alias,
    discordId: options.discordId ?? null,
    serverId,
    creatorDiscordId,
    createdTime: now,
    updatedTime: now,
  };
  if (options.puuid === undefined) {
    return prisma.player.create({ data: basePlayer });
  }
  return prisma.player.create({
    data: {
      ...basePlayer,
      accounts: {
        create: [
          {
            alias: options.alias,
            puuid: options.puuid,
            region: options.region ?? "AMERICA_NORTH",
            serverId,
            creatorDiscordId,
            createdTime: now,
            updatedTime: now,
          },
        ],
      },
    },
  });
}

export async function addCompetitionParticipantFixture(
  prisma: ExtendedPrismaClient,
  competitionId: Parameters<typeof addParticipant>[0]["competitionId"],
  playerId: Parameters<typeof addParticipant>[0]["playerId"],
  status: ParticipantStatus = "JOINED",
) {
  const now = new Date();
  return prisma.competitionParticipant.create({
    data: {
      competitionId,
      playerId,
      status,
      joinedAt: status === "JOINED" ? now : null,
      invitedAt: status === "INVITED" ? now : null,
    },
  });
}

export async function resetCompetitionFixtures(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  await prisma.competitionSnapshot.deleteMany();
  await prisma.competitionParticipant.deleteMany();
  await prisma.competition.deleteMany();
  await prisma.serverPermission.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
}
