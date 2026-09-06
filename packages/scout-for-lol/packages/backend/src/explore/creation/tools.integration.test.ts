import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  ConfirmationIntentPayloadSchema,
  rootPermissions,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { CreationAccess } from "#src/explore/creation/capability.ts";
import { CREATION_INTENT_TTL_MS } from "#src/explore/creation/context.ts";
import { createCreationToolExecutors } from "#src/explore/creation/tools.ts";
import type { PostableChannel } from "#src/lib/discord/postable-channels.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

/**
 * The prepare side of Explore-driven creation. Every executor here may only
 * mint a proposal, so what these tests pin is that a valid request produces an
 * intent row a human still has to confirm, and that every refusal is a domain
 * result rather than a claim that something was created.
 */
const { prisma } = createTestDatabase("explore-creation-tools-test");

const GUILD = testGuildId("520001");
const OTHER_GUILD = testGuildId("520002");
const CHANNEL = testChannelId("520003");
const FOREIGN_CHANNEL = testChannelId("520004");
const REQUESTER = testAccountId("910000201");

const QUERY_TEXT =
  "SELECT player, COUNT(*) AS games FROM match_participants GROUP BY player RENDER table";

const CHANNELS: PostableChannel[] = [
  { id: CHANNEL, name: "scout-reports", parentId: null },
];

const passthroughTracker: ToolTracker = async (_toolName, work) => await work();

const resolvedAccess: CreationAccess = {
  kind: "resolved",
  guilds: [
    { guildId: GUILD, name: "Test Server", permissions: rootPermissions() },
  ],
};

function executors(overrides?: { access?: CreationAccess }) {
  return createCreationToolExecutors({
    capability: { guildIds: [GUILD] },
    requesterId: REQUESTER,
    track: passthroughTracker,
    dependencies: {
      db: prisma,
      resolveAccess: () => Promise.resolve(overrides?.access ?? resolvedAccess),
      listChannels: (guildId: DiscordGuildId) =>
        guildId === GUILD ? CHANNELS : [],
      resolvePuuid: () =>
        Promise.resolve({
          kind: "ok",
          puuid: testPuuid("prepared"),
          // Riot's canonical casing differs from what the model typed.
          gameName: "Prepared",
          tagLine: "NA1",
        }),
      now: () => new Date("2026-09-05T00:00:00.000Z"),
    },
  });
}

function reportInput(overrides?: Record<string, unknown>) {
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    title: "Weekly games",
    queryText: QUERY_TEXT,
    ...overrides,
  };
}

function subscriptionInput(overrides?: Record<string, unknown>) {
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    region: "AMERICA_NORTH",
    // Deliberately mis-cased: the payload must carry Riot's answer, not this.
    riotId: { game_name: "prepared", tag_line: "na1" },
    alias: "Prepared",
    ...overrides,
  };
}

function competitionInput(overrides?: Record<string, unknown>) {
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    title: "September ladder",
    description: "Most games played this month.",
    visibility: "INVITE_ONLY",
    dates: {
      type: "FIXED_DATES",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-30T00:00:00.000Z",
    },
    criteria: { type: "MOST_GAMES_PLAYED", queues: ["flex"] },
    ...overrides,
  };
}

async function seedEnabledReport(title: string): Promise<void> {
  const now = new Date();
  await prisma.report.create({
    data: {
      serverId: GUILD,
      ownerId: REQUESTER,
      channelId: CHANNEL,
      title,
      queryText: QUERY_TEXT,
      isEnabled: true,
      isSystemManaged: false,
      cronExpression: "0 12 * * 1",
      scheduleTimezone: "UTC",
      createdTime: now,
      updatedTime: now,
    },
  });
}

beforeEach(async () => {
  await prisma.confirmationIntent.deleteMany();
  await prisma.reportScheduleOutbox.deleteMany();
  await prisma.report.deleteMany();
  await prisma.competitionParticipant.deleteMany();
  await prisma.competition.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("prepare_report_creation", () => {
  test("a valid request mints an intent and creates nothing", async () => {
    const result = await executors().prepareReport(reportInput());

    expect(result.kind).toBe("creation_confirmation_required");
    expect(result.intent?.kind).toBe("report");
    expect(result.intent?.guildId).toBe(GUILD);
    expect(result.intent?.summary).toContain("scout-reports");
    expect(result.message).toContain("Nothing has been created yet");

    const rows = await prisma.confirmationIntent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("report");
    expect(rows[0]?.serverId).toBe(GUILD);
    expect(rows[0]?.actorDiscordId).toBe(REQUESTER);
    expect(rows[0]?.expiresAt.toISOString()).toBe(
      new Date(
        new Date("2026-09-05T00:00:00.000Z").getTime() + CREATION_INTENT_TTL_MS,
      ).toISOString(),
    );
    // The proposal is a proposal: no report exists yet.
    await expect(prisma.report.count()).resolves.toBe(0);
  });

  test("two identical requests mint two intents", async () => {
    // The key is a fresh UUID per call, not a hash of the payload: asking for a
    // second identical report is a legitimate request.
    const tools = executors();
    const first = await tools.prepareReport(reportInput());
    const second = await tools.prepareReport(reportInput());

    expect(first.intent?.intentId).not.toBe(second.intent?.intentId);
    await expect(prisma.confirmationIntent.count()).resolves.toBe(2);
  });

  test("uncompilable ScoutQL is refused before anything is minted", async () => {
    const result = await executors().prepareReport(
      reportInput({ queryText: "SELECT nonsense FROM nowhere" }),
    );

    expect(result.kind).toBe("invalid");
    expect(result.intent).toBeNull();
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });

  test("a channel Scout cannot post in is refused", async () => {
    const result = await executors().prepareReport(
      reportInput({ channelId: FOREIGN_CHANNEL }),
    );

    expect(result.kind).toBe("invalid");
    expect(result.message).toContain("list_guild_channels");
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });

  test("the per-owner report limit is previewed rather than minted into", async () => {
    // reports_per_owner_per_server defaults to 2.
    await seedEnabledReport("First");
    await seedEnabledReport("Second");

    const result = await executors().prepareReport(reportInput());

    expect(result.kind).toBe("limit_reached");
    expect(result.message).toContain("2/2");
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });

  test("a guild outside the resolved access is a forbidden target", async () => {
    const result = await executors().prepareReport(
      reportInput({ guildId: OTHER_GUILD }),
    );

    expect(result.kind).toBe("forbidden_target");
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });

  test("an unverifiable turn says so instead of denying", async () => {
    const result = await executors({
      access: {
        kind: "verification_unavailable",
        message: "Scout could not reach Discord to verify …",
      },
    }).prepareReport(reportInput());

    expect(result.kind).toBe("verification_unavailable");
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });
});

describe("prepare_subscription_creation", () => {
  test("Riot's canonical Riot ID and PUUID are frozen into the payload", async () => {
    const result = await executors().prepareSubscription(subscriptionInput());

    expect(result.kind).toBe("creation_confirmation_required");
    const row = await prisma.confirmationIntent.findFirstOrThrow();
    const payload = ConfirmationIntentPayloadSchema.parse(
      JSON.parse(row.payload),
    );
    expect(payload.kind).toBe("subscription");
    if (payload.kind !== "subscription") return;
    // Not the "prepared"/"na1" the caller typed.
    expect(payload.riotId).toEqual({ game_name: "Prepared", tag_line: "NA1" });
    expect(payload.puuid).toBe(testPuuid("prepared"));
  });

  test("an unknown Riot ID is refused with Riot's own reason", async () => {
    const tools = createCreationToolExecutors({
      capability: { guildIds: [GUILD] },
      requesterId: REQUESTER,
      track: passthroughTracker,
      dependencies: {
        db: prisma,
        resolveAccess: () => Promise.resolve(resolvedAccess),
        listChannels: () => CHANNELS,
        resolvePuuid: () =>
          Promise.resolve({
            kind: "riot-id-not-found",
            message: "No Riot account named prepared#na1 in AMERICA_NORTH.",
          }),
      },
    });

    const result = await tools.prepareSubscription(subscriptionInput());

    expect(result.kind).toBe("invalid");
    expect(result.message).toContain("No Riot account named");
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });

  test("an already-tracked account is refused rather than prepared", async () => {
    const now = new Date();
    await prisma.account.create({
      data: {
        alias: "Existing",
        puuid: testPuuid("prepared"),
        region: "AMERICA_NORTH",
        riotGameName: "Prepared",
        riotTagLine: "NA1",
        serverId: GUILD,
        creatorDiscordId: REQUESTER,
        createdTime: now,
        updatedTime: now,
        player: {
          create: {
            alias: "Existing",
            serverId: GUILD,
            creatorDiscordId: REQUESTER,
            createdTime: now,
            updatedTime: now,
          },
        },
      },
    });

    const result = await executors().prepareSubscription(subscriptionInput());

    expect(result.kind).toBe("invalid");
    expect(result.message).toContain("already tracked");
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });
});

describe("prepare_competition_creation", () => {
  test("a valid request mints a competition intent", async () => {
    const result = await executors().prepareCompetition(competitionInput());

    expect(result.kind).toBe("creation_confirmation_required");
    expect(result.intent?.kind).toBe("competition");
    const row = await prisma.confirmationIntent.findFirstOrThrow();
    expect(row.kind).toBe("competition");
    await expect(prisma.competition.count()).resolves.toBe(0);
  });

  test("a window longer than the 90-day cap is refused here, not at confirm", async () => {
    const result = await executors().prepareCompetition(
      competitionInput({
        dates: {
          type: "FIXED_DATES",
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-12-01T00:00:00.000Z",
        },
      }),
    );

    expect(result.kind).toBe("invalid");
    expect(result.message).toContain("90 days");
    await expect(prisma.confirmationIntent.count()).resolves.toBe(0);
  });
});

describe("list_creation_targets", () => {
  test("inlines the channels of the single eligible server", async () => {
    const result = await executors().listTargets();

    expect(result.kind).toBe("targets");
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.name).toBe("Test Server");
    expect(result.targets[0]?.report.permitted).toBe(true);
    expect(result.targets[0]?.report.atLimit).toBe(false);
    expect(result.targets[0]?.channels).toEqual([
      { id: CHANNEL, name: "scout-reports" },
    ]);
  });

  test("reports a reached limit alongside the permission", async () => {
    await seedEnabledReport("First");
    await seedEnabledReport("Second");

    const result = await executors().listTargets();

    expect(result.targets[0]?.report).toMatchObject({
      permitted: true,
      atLimit: true,
    });
  });

  test("an unverifiable turn returns no targets and says why", async () => {
    const result = await executors({
      access: {
        kind: "verification_unavailable",
        message: "Scout could not reach Discord to verify …",
      },
    }).listTargets();

    expect(result.kind).toBe("verification_unavailable");
    expect(result.targets).toEqual([]);
  });
});

describe("list_guild_channels", () => {
  test("returns the postable channels of an eligible server", async () => {
    const result = await executors().listChannels({ guildId: GUILD });

    expect(result.kind).toBe("channels");
    expect(result.channels).toEqual([{ id: CHANNEL, name: "scout-reports" }]);
  });

  test("refuses a server outside the resolved access", async () => {
    const result = await executors().listChannels({ guildId: OTHER_GUILD });

    expect(result.kind).toBe("forbidden_target");
    expect(result.channels).toEqual([]);
  });
});
