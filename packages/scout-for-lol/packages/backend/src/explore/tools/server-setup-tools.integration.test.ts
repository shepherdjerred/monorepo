import { TRPCError } from "@trpc/server";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  createPermissionSet,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PLAYER_PERMISSIONS,
  rootPermissions,
  type PermissionSet,
} from "@scout-for-lol/data";
import {
  createServerSetupExecutor,
  setupFindings,
} from "#src/explore/tools/server-setup-tools.ts";
import type { PostableChannel } from "#src/lib/discord/postable-channels.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testPuuid } from "#src/testing/test-ids.ts";
import { SCENARIO_REPORT_QUERY } from "#src/explore/scenarios/fixtures.ts";

const { prisma } = createTestDatabase("explore-server-setup-test");
const ASKER = testAccountId("91");
const SERVER = DiscordGuildIdSchema.parse("100000000000000091");
const OTHER = DiscordGuildIdSchema.parse("100000000000000092");
const GENERAL = DiscordChannelIdSchema.parse("200000000000000091");
const GONE = DiscordChannelIdSchema.parse("200000000000000092");
const STAMPS = {
  serverId: SERVER,
  creatorDiscordId: ASKER,
  createdTime: new Date("2026-10-01T00:00:00.000Z"),
  updatedTime: new Date("2026-10-01T00:00:00.000Z"),
};

const CHANNELS: PostableChannel[] = [
  { id: GENERAL, name: "general", parentId: null },
];

async function readSetup(
  server: typeof SERVER | null,
  guildIds = [SERVER],
  permissions: PermissionSet | Error = rootPermissions(),
  /** Channels where Scout may also attach files. */
  withFiles: readonly PostableChannel[] = CHANNELS,
) {
  const execute = createServerSetupExecutor(
    { db: prisma, guildIds, requesterId: ASKER },
    {
      listChannels: (_guildId, options) =>
        Promise.resolve(options.needsAttachments ? [...withFiles] : CHANNELS),
      resolvePermissions: () =>
        permissions instanceof Error
          ? Promise.reject(permissions)
          : Promise.resolve(permissions),
    },
  );
  return await execute({ server });
}

async function trackPlayer(
  alias: string,
  feedChannel: typeof GENERAL | null,
  isMuted = false,
) {
  const player = await prisma.player.create({
    data: {
      alias,
      ...STAMPS,
      accounts: {
        create: {
          alias,
          puuid: testPuuid(alias),
          region: "AMERICA_NORTH",
          riotGameName: alias,
          riotTagLine: "NA1",
          ...STAMPS,
        },
      },
    },
  });
  if (feedChannel !== null) {
    await prisma.subscription.create({
      data: { playerId: player.id, channelId: feedChannel, isMuted, ...STAMPS },
    });
  }
}

async function deliveredPost(key: string, deliveredAt: Date) {
  const matchId = RiotMatchIdSchema.parse(
    `NA1_${String(deliveredAt.getTime())}`,
  );
  await prisma.matchNotificationIntent.create({
    data: {
      intentKey: `setup-${key}`,
      subjectKind: "match",
      subjectId: matchId,
      riotMatchId: matchId,
      kind: "postmatch",
      originKind: "live",
      targetKind: "channel",
      targetId: GENERAL,
      state: "delivered",
      deliveredAt,
      freshnessDeadline: deliveredAt,
      payload: JSON.stringify({
        kind: "notification-intent",
        version: 1,
        data: {},
      }),
      createdAt: deliveredAt,
      updatedAt: deliveredAt,
    },
  });
}

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.report.deleteMany();
  await prisma.guildInstall.deleteMany();
  await prisma.guildInstall.create({
    data: {
      serverId: SERVER,
      serverName: "Harbor Lane",
      ownerDiscordId: ASKER,
      addedByDiscordId: ASKER,
      memberCount: 4,
      installedAt: STAMPS.createdTime,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("setupFindings", () => {
  test("no tracked players is the whole answer", () => {
    expect(
      setupFindings({
        trackedPlayers: 0,
        feeds: 0,
        mutedFeeds: 0,
        unreachableFeeds: 0,
        unreachableReports: 0,
        accessUnverified: false,
        lastMatchPost: null,
      }),
    ).toEqual([expect.stringContaining("tracks no players")]);
  });

  test("players without feeds, and feeds Scout cannot post in, are each named", () => {
    const findings = setupFindings({
      trackedPlayers: 2,
      feeds: 0,
      mutedFeeds: 0,
      unreachableFeeds: 0,
      unreachableReports: 0,
      accessUnverified: false,
      lastMatchPost: null,
    });
    expect(findings.join(" ")).toContain("none has a feed");
    expect(
      setupFindings({
        trackedPlayers: 2,
        feeds: 2,
        mutedFeeds: 0,
        unreachableFeeds: 1,
        unreachableReports: 0,
        accessUnverified: false,
        lastMatchPost: new Date(),
      }).join(" "),
    ).toContain("can no longer post in");
  });

  test("report findings stand when no players are tracked", () => {
    const findings = setupFindings({
      trackedPlayers: 0,
      feeds: 0,
      mutedFeeds: 0,
      unreachableFeeds: 0,
      unreachableReports: 1,
      accessUnverified: false,
      lastMatchPost: null,
    }).join(" ");
    expect(findings).toContain("tracks no players");
    expect(findings).toContain("1 scheduled report(s)");
  });

  test("muted feeds, unverified access and dead report channels are named", () => {
    const findings = setupFindings({
      trackedPlayers: 2,
      feeds: 2,
      mutedFeeds: 2,
      unreachableFeeds: 0,
      unreachableReports: 1,
      accessUnverified: true,
      lastMatchPost: new Date(),
    }).join(" ");
    expect(findings).toContain("Every feed on this server is muted");
    expect(findings).toContain("delivery is unverified");
    expect(findings).toContain("1 scheduled report(s)");
  });
});

describe("get_server_setup", () => {
  test("an empty server leads with why nothing posts", async () => {
    const result = await readSetup(null);
    expect(result.kind).toBe("server_setup");
    expect(result.message).toContain("tracks no players");
  });

  test("lists players, feeds and reports, naming a channel Scout lost", async () => {
    await trackPlayer("Tarrow", GENERAL);
    await trackPlayer("Linden", GONE);
    await prisma.report.create({
      data: {
        serverId: SERVER,
        ownerId: ASKER,
        channelId: GENERAL,
        title: "Weekly Win Rates",
        queryText: SCENARIO_REPORT_QUERY,
        cronExpression: "0 12 * * 1",
        isEnabled: true,
        createdTime: STAMPS.createdTime,
        updatedTime: STAMPS.updatedTime,
      },
    });

    const result = await readSetup(SERVER);
    const json = JSON.stringify(result.data);
    expect(json).toContain('"server":"Harbor Lane"');
    expect(json).toContain('"channel":"#general"');
    expect(json).toContain("a channel Scout can no longer post in");
    expect(json).toContain('"title":"Weekly Win Rates"');
    expect(json).toContain("/app/g/100000000000000091/reports");
    expect(result.message).toContain("can no longer post in");
  });

  test("a muted feed explains why nothing posts", async () => {
    await trackPlayer("Tarrow", GENERAL, true);
    const result = await readSetup(SERVER);
    expect(result.message).toContain("Every feed on this server is muted");
  });

  test("a post from before the current feed existed does not count as delivery", async () => {
    await trackPlayer("Tarrow", GENERAL);
    const feedCreated = STAMPS.createdTime.getTime();
    const neverDelivered =
      "No match report has been delivered from these feeds yet";
    await deliveredPost("old", new Date(feedCreated - 86_400_000));
    const before = await readSetup(SERVER);
    expect(before.message).toContain(neverDelivered);
    await deliveredPost("new", new Date(feedCreated + 86_400_000));
    const after = await readSetup(SERVER);
    expect(after.message).not.toContain(neverDelivered);
  });

  test("without Attach Files, feeds fail but only chart reports do", async () => {
    await trackPlayer("Tarrow", GENERAL);
    await prisma.report.create({
      data: {
        serverId: SERVER,
        ownerId: ASKER,
        channelId: GENERAL,
        title: "Weekly Win Rates",
        queryText: SCENARIO_REPORT_QUERY,
        cronExpression: "0 12 * * 1",
        isEnabled: true,
        createdTime: STAMPS.createdTime,
        updatedTime: STAMPS.updatedTime,
      },
    });
    const result = await readSetup(SERVER, [SERVER], rootPermissions(), []);
    expect(result.message).not.toContain("can no longer post in");
    expect(result.message).toContain(
      "1 feed(s) post to a channel where Scout cannot attach files",
    );
    expect(result.message).toContain("text reports still post");
  });

  test("a muted feed in a lost channel is not reported as a fault", async () => {
    await trackPlayer("Tarrow", GENERAL);
    await trackPlayer("Linden", GONE, true);
    const result = await readSetup(SERVER);
    expect(result.message).not.toContain("can no longer post in");
  });

  test("a plain member sees counts, not feed channels or the channel list", async () => {
    await trackPlayer("Tarrow", GENERAL);
    const result = await readSetup(
      SERVER,
      [SERVER],
      createPermissionSet(PLAYER_PERMISSIONS),
    );
    const json = JSON.stringify(result.data);
    expect(json).not.toContain("#general");
    expect(json).toContain("subscriptions:read");
    expect(json).toContain("channels:read");
  });

  test("an outage hides protected fields without calling it a denial", async () => {
    await trackPlayer("Tarrow", GENERAL);
    const result = await readSetup(
      SERVER,
      [SERVER],
      new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Discord down" }),
    );
    const json = JSON.stringify(result.data);
    expect(json).not.toContain("#general");
    expect(json).toContain("could not be reached to check your permissions");
    expect(json).not.toContain("subscriptions:read");
  });

  test("a member without reports:create is not told they can add one", async () => {
    const result = await readSetup(
      SERVER,
      [SERVER],
      createPermissionSet(PLAYER_PERMISSIONS),
    );
    expect(JSON.stringify(result.data)).toContain(
      "lacks the reports:create permission",
    );
  });

  test("several servers in scope with none named asks which", async () => {
    const result = await readSetup(null, [SERVER, OTHER]);
    expect(result.kind).toBe("choose_server");
  });

  test("no server in scope is unavailable, not a choice", async () => {
    const result = await readSetup(null, []);
    expect(result.kind).toBe("unavailable");
  });

  test("a server outside the turn's scope is refused", async () => {
    const result = await readSetup(OTHER);
    expect(result.kind).toBe("unavailable");
  });
});
