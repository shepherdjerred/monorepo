import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
  permissionKey,
  type PlayerId,
  type Permission,
  type CompetitionVisibility,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { clearAllRateLimits } from "#src/database/competition/rate-limit.ts";

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
  const ids: PlayerId[] = [];
  for (let index = 0; index < count; index += 1) {
    const player = await testPrisma.player.create({
      data: {
        alias: `Player ${index.toString()}`,
        serverId: guildId,
        creatorDiscordId: actorDiscordId,
        createdTime: now,
        updatedTime: now,
      },
    });
    ids.push(PlayerIdSchema.parse(player.id));
  }
  return ids;
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
    // Relative to the test clock so the competition is always active (endDate in
    // the future) regardless of wall-clock date; 60 days keeps it under the
    // 90-day fixed-duration cap.
    dates: {
      type: "FIXED_DATES" as const,
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
    criteria: {
      type: "MOST_GAMES_PLAYED" as const,
      queues: [...(["flex"] as const)],
    },
    updateCronExpression: null,
  };
}

beforeEach(async () => {
  await testPrisma.competitionParticipant.deleteMany();
  await testPrisma.competition.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.serverPermission.deleteMany();
  clearAllRateLimits();
  trpc.setMembership("root");
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

  test("round-trips multi-queue Ranked 5s scoring, timezone, schedule, and selected JOINED roster", async () => {
    const guildId = nextGuildId();
    const playerIds = await seedPlayers(guildId, 2);
    const competition = await trpc.authedCaller().competition.create({
      ...createInput(guildId, "OPEN"),
      gameVariant: "MODERN",
      criteria: {
        type: "HIGHEST_RANK",
        aggregation: "SUM",
        queues: ["solo", "flex", "ranked 5s"],
      },
      initialPlayerIds: playerIds,
      analysisTimezone: "America/Los_Angeles",
      scheduledUpdates: {
        enabled: true,
        cronExpression: "0 9 * * *",
        timezone: "America/Los_Angeles",
      },
    });
    const saved = await testPrisma.competition.findUniqueOrThrow({
      where: { id: competition.id },
    });
    const participants = await testPrisma.competitionParticipant.findMany({
      where: { competitionId: competition.id },
      orderBy: { playerId: "asc" },
    });
    expect(competition.criteria).toEqual({
      type: "HIGHEST_RANK",
      aggregation: "SUM",
      queues: ["solo", "flex", "ranked 5s"],
    });
    expect(saved).toMatchObject({
      gameVariant: "MODERN",
      criteriaType: "HIGHEST_RANK",
      analysisTimezone: "America/Los_Angeles",
      scheduledUpdatesEnabled: true,
      updateCronExpression: "0 9 * * *",
      scheduleTimezone: "America/Los_Angeles",
    });
    expect(participants.map((participant) => participant.playerId)).toEqual(
      playerIds,
    );
    expect(
      participants.every((participant) => participant.status === "JOINED"),
    ).toBe(true);
  });

  test("rejects duplicate initial players and rolls creation back", async () => {
    const guildId = nextGuildId();
    const [playerId] = await seedPlayers(guildId, 1);
    expect(playerId).toBeDefined();
    if (playerId === undefined) return;
    await expect(
      trpc.authedCaller().competition.create({
        ...createInput(guildId, "OPEN"),
        initialPlayerIds: [playerId, playerId],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Initial entrants must be unique"),
    });
    expect(
      await testPrisma.competition.count({ where: { serverId: guildId } }),
    ).toBe(0);
  });

  test("rejects cross-guild initial players and rolls creation back", async () => {
    const guildId = nextGuildId();
    const otherGuildId = nextGuildId();
    const [playerId] = await seedPlayers(otherGuildId, 1);
    expect(playerId).toBeDefined();
    if (playerId === undefined) return;
    await expect(
      trpc.authedCaller().competition.create({
        ...createInput(guildId, "INVITE_ONLY"),
        initialPlayerIds: [playerId],
      }),
    ).rejects.toThrow("tracked player in this server");
    expect(
      await testPrisma.competition.count({ where: { serverId: guildId } }),
    ).toBe(0);
  });

  test("rejects an initial roster larger than the cap and rolls creation back", async () => {
    const guildId = nextGuildId();
    const playerIds = await seedPlayers(guildId, 3);
    await expect(
      trpc.authedCaller().competition.create({
        ...createInput(guildId, "OPEN", 2),
        initialPlayerIds: playerIds,
      }),
    ).rejects.toThrow("exceed the participant cap");
    expect(
      await testPrisma.competition.count({ where: { serverId: guildId } }),
    ).toBe(0);
  });

  test("legacy create input keeps leaderboard updates disabled in UTC", async () => {
    const guildId = nextGuildId();
    const competition = await trpc
      .authedCaller()
      .competition.create(createInput(guildId, "OPEN"));
    const saved = await testPrisma.competition.findUniqueOrThrow({
      where: { id: competition.id },
    });
    expect(saved.scheduledUpdatesEnabled).toBe(false);
    expect(saved.scheduleTimezone).toBe("UTC");
  });

  test("uses the API and database participant-cap default of 100", async () => {
    const guildId = nextGuildId();
    const { maxParticipants: _maxParticipants, ...input } = createInput(
      guildId,
      "OPEN",
    );
    const competition = await trpc.authedCaller().competition.create(input);
    const saved = await testPrisma.competition.findUniqueOrThrow({
      where: { id: competition.id },
    });
    expect(competition.maxParticipants).toBe(100);
    expect(saved.maxParticipants).toBe(100);
  });

  test("round-trips Classic queues and a Jade champion", async () => {
    const guildId = nextGuildId();
    const competition = await trpc.authedCaller().competition.create({
      ...createInput(guildId, "OPEN"),
      gameVariant: "CLASSIC",
      criteria: {
        type: "MOST_WINS_CHAMPION",
        championId: 60_084,
        queues: ["classic", "classic aram mayhem"],
      },
    });
    expect(competition.gameVariant).toBe("CLASSIC");
    expect(competition.criteria).toEqual({
      type: "MOST_WINS_CHAMPION",
      championId: 60_084,
      queues: ["classic", "classic aram mayhem"],
    });
  });

  test("rejects a champion from the other game variant transactionally", async () => {
    const guildId = nextGuildId();
    await expect(
      trpc.authedCaller().competition.create({
        ...createInput(guildId, "OPEN"),
        gameVariant: "MODERN",
        criteria: {
          type: "MOST_WINS_CHAMPION",
          championId: 60_084,
          queues: ["aram"],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await testPrisma.competition.count({ where: { serverId: guildId } }),
    ).toBe(0);
  });
});

async function seedPermissions(
  guildId: ReturnType<typeof nextGuildId>,
  permissions: readonly Permission[],
) {
  await testPrisma.serverPermission.createMany({
    data: permissions.map((permission) => ({
      serverId: guildId,
      discordUserId: actorDiscordId,
      permission: permissionKey(permission),
      grantedBy: actorDiscordId,
      grantedAt: new Date(),
    })),
  });
}

describe("competition.create advanced permissions", () => {
  test("initial entrants require competitions:invite", async () => {
    const guildId = nextGuildId();
    const [playerId] = await seedPlayers(guildId, 1);
    expect(playerId).toBeDefined();
    if (playerId === undefined) return;
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedPermissions(guildId, [
      { resource: "competitions", action: "create" },
    ]);
    await expect(
      trpc.authedCaller(actorDiscordId).competition.create({
        ...createInput(guildId, "OPEN"),
        initialPlayerIds: [playerId],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("enabled scheduling requires competitions:schedule", async () => {
    const guildId = nextGuildId();
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedPermissions(guildId, [
      { resource: "competitions", action: "create" },
    ]);
    await expect(
      trpc.authedCaller(actorDiscordId).competition.create({
        ...createInput(guildId, "OPEN"),
        scheduledUpdates: {
          enabled: true,
          cronExpression: "0 9 * * *",
          timezone: "America/Los_Angeles",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("server-wide enrollment requires competitions:invite", async () => {
    const guildId = nextGuildId();
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedPermissions(guildId, [
      { resource: "competitions", action: "create" },
    ]);
    await expect(
      trpc
        .authedCaller(actorDiscordId)
        .competition.create(createInput(guildId, "SERVER_WIDE")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a disabled custom cadence still requires competitions:schedule", async () => {
    const guildId = nextGuildId();
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedPermissions(guildId, [
      { resource: "competitions", action: "create" },
    ]);
    await expect(
      trpc.authedCaller(actorDiscordId).competition.create({
        ...createInput(guildId, "OPEN"),
        scheduledUpdates: {
          enabled: false,
          cronExpression: "0 12 * * *",
          timezone: "America/Los_Angeles",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("competition.updateSchedule", () => {
  test("enables in the saved timezone and disabling clears the next fire", async () => {
    const guildId = nextGuildId();
    const competition = await trpc
      .authedCaller()
      .competition.create(createInput(guildId, "OPEN"));
    await testPrisma.competition.update({
      where: { id: competition.id },
      data: { startProcessedAt: new Date() },
    });

    const enabled = await trpc.authedCaller().competition.updateSchedule({
      guildId,
      competitionId: competition.id,
      scheduledUpdates: {
        enabled: true,
        cronExpression: "0 9 * * *",
        timezone: "Asia/Tokyo",
      },
    });
    expect(enabled).toMatchObject({
      scheduledUpdatesEnabled: true,
      updateCronExpression: "0 9 * * *",
      scheduleTimezone: "Asia/Tokyo",
    });
    expect(enabled.nextScheduledUpdateAt).not.toBeNull();
    if (enabled.nextScheduledUpdateAt === null) return;
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo",
        hour: "numeric",
        hourCycle: "h23",
      }).format(enabled.nextScheduledUpdateAt),
    ).toBe("09");

    const disabled = await trpc.authedCaller().competition.updateSchedule({
      guildId,
      competitionId: competition.id,
      scheduledUpdates: {
        enabled: false,
        cronExpression: "0 9 * * *",
        timezone: "Asia/Tokyo",
      },
    });
    expect(disabled.scheduledUpdatesEnabled).toBe(false);
    expect(disabled.nextScheduledUpdateAt).toBeNull();
  });

  test("requires competitions:schedule for later edits", async () => {
    const guildId = nextGuildId();
    const competition = await trpc
      .authedCaller()
      .competition.create(createInput(guildId, "OPEN"));
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedPermissions(guildId, [
      { resource: "competitions", action: "create" },
    ]);
    await expect(
      trpc.authedCaller(actorDiscordId).competition.updateSchedule({
        guildId,
        competitionId: competition.id,
        scheduledUpdates: {
          enabled: true,
          cronExpression: "0 9 * * *",
          timezone: "UTC",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
