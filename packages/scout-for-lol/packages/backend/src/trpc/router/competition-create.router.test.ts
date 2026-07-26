import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type CompetitionVisibility,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

// Offline tRPC harness: real router + audit writes, no Discord OAuth, no real
// Discord backing. See src/testing/test-trpc-caller.ts.
const trpc = await createOfflineTrpcHarness("trpc-competition-create-test");
const { prisma: testPrisma } = trpc;

// The create procedure rate-limits per (guild, owner) in memory, so each
// test uses its own guild id (the harness stubs guild membership checks).
let guildCounter = 0;
function nextGuildId() {
  guildCounter += 1;
  return DiscordGuildIdSchema.parse(
    `10000000000000${guildCounter.toString().padStart(4, "0")}`,
  );
}
const channelId = DiscordChannelIdSchema.parse("200000000000000005");
const actorDiscordId = DiscordAccountIdSchema.parse("300000000000000005");

async function seedPlayers(
  guildId: ReturnType<typeof nextGuildId>,
  count: number,
) {
  const now = new Date();
  for (let index = 0; index < count; index += 1) {
    await testPrisma.player.create({
      data: {
        alias: `Player ${index.toString()}`,
        serverId: guildId,
        creatorDiscordId: actorDiscordId,
        createdTime: now,
        updatedTime: now,
      },
    });
  }
}

function createInput(
  guildId: ReturnType<typeof nextGuildId>,
  visibility: CompetitionVisibility,
  maxParticipants = 50,
) {
  return {
    guildId,
    channelId,
    title: `${visibility} competition`,
    description: "Auto-enrollment test",
    visibility,
    maxParticipants,
    dates: {
      type: "FIXED_DATES" as const,
      startDate: new Date("2026-08-01T00:00:00Z"),
      endDate: new Date("2026-10-01T00:00:00Z"),
    },
    criteria: { type: "MOST_GAMES_PLAYED" as const, queue: "FLEX" as const },
    updateCronExpression: null,
  };
}

beforeEach(async () => {
  await testPrisma.competitionParticipant.deleteMany();
  await testPrisma.competition.deleteMany();
  await testPrisma.player.deleteMany();
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("competition.create auto-enrollment", () => {
  test("SERVER_WIDE enrolls every tracked player as JOINED", async () => {
    const guildId = nextGuildId();
    await seedPlayers(guildId, 3);

    const competition = await trpc
      .authedCaller()
      .competition.create(createInput(guildId, "SERVER_WIDE"));

    const participants = await testPrisma.competitionParticipant.findMany({
      where: { competitionId: competition.id },
    });
    expect(participants).toHaveLength(3);
    expect(participants.every((entry) => entry.status === "JOINED")).toBe(true);
  });

  test("SERVER_WIDE enrollment stops at maxParticipants", async () => {
    const guildId = nextGuildId();
    await seedPlayers(guildId, 4);

    const competition = await trpc
      .authedCaller()
      .competition.create(createInput(guildId, "SERVER_WIDE", 2));

    const participants = await testPrisma.competitionParticipant.findMany({
      where: { competitionId: competition.id },
    });
    expect(participants).toHaveLength(2);
  });

  test("OPEN competitions enroll nobody automatically", async () => {
    const guildId = nextGuildId();
    await seedPlayers(guildId, 3);

    const competition = await trpc
      .authedCaller()
      .competition.create(createInput(guildId, "OPEN"));

    const participants = await testPrisma.competitionParticipant.findMany({
      where: { competitionId: competition.id },
    });
    expect(participants).toHaveLength(0);
  });
});
