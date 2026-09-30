import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  MatchIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestPuuid } from "#src/testing/bucks-fixtures.ts";
import { freezeMvpTestRoster } from "#src/testing/mvp-votes-fixtures.ts";
import { refreshMvpTallyMessages } from "#src/mvp-votes/message-refresh.ts";
import { reconcileMvpTallyRefresh } from "#src/mvp-votes/tally-reconciliation.ts";
import {
  recordMatchMvpOwnedReportRef,
  recordMatchMvpReportRefs,
  upsertMatchMvpVote,
} from "#src/mvp-votes/vote.ts";

const stubs = vi.hoisted(() => ({ fetchChannelForDelivery: vi.fn() }));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));

const { prisma: db } = createTestDatabase("mvp-message-refresh");
const matchId = MatchIdSchema.parse("NA1_5000000099");
const serverId = DiscordGuildIdSchema.parse("1337623164146155593");
const firstChannel = DiscordChannelIdSchema.parse("300000000000000001");
const secondChannel = DiscordChannelIdSchema.parse("300000000000000002");
const key = { matchId, serverId };
const where = { matchId_serverId: key };
const skipEdit = () => Promise.resolve();
const refreshWithoutEdit = (
  input: Parameters<typeof refreshMvpTallyMessages>[0],
  client: Parameters<typeof refreshMvpTallyMessages>[1],
) => refreshMvpTallyMessages(input, client, skipEdit);

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  stubs.fetchChannelForDelivery.mockReset();
  stubs.fetchChannelForDelivery.mockImplementation(async () => ({
    guildId: serverId,
    isTextBased: () => true,
    messages: { fetch: async () => ({ embeds: [] }) },
  }));
  await db.matchMvpTallyRefresh.deleteMany();
  await db.matchMvpReportTarget.deleteMany();
  await db.matchMvpVote.deleteMany();
  await db.matchMvpContest.deleteMany();
  await db.matchMvpContest.create({
    data: { matchId, roster: freezeMvpTestRoster(matchId) },
  });
  await recordMatchMvpOwnedReportRef(
    {
      matchId,
      serverId,
      channelId: firstChannel,
      messageId: "400000000000000001",
    },
    db,
  );
  await recordMatchMvpOwnedReportRef(
    {
      matchId,
      serverId,
      channelId: secondChannel,
      messageId: "400000000000000002",
    },
    db,
  );
  await upsertMatchMvpVote(
    {
      ...key,
      voterDiscordId: DiscordAccountIdSchema.parse("160509172704739328"),
      category: "ally",
      nomineeIndex: 1,
      voterPuuid: bucksTestPuuid(0),
      voterTeamId: 100,
    },
    db,
  );
});

describe("MVP terminal report targets", () => {
  test("reopens a retired legacy request when its existing ref gains guild ownership", async () => {
    await db.matchMvpReportTarget.deleteMany({ where: { matchId } });
    await db.matchMvpTallyRefresh.update({
      where,
      data: {
        pending: false,
        lastErrorCode: "legacy-target-ownership-unknown",
      },
    });
    await recordMatchMvpOwnedReportRef(
      {
        matchId,
        serverId,
        channelId: firstChannel,
        messageId: "400000000000000001",
      },
      db,
    );
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ pending: true, requeueGeneration: 1 });
  });

  test("closes when every owned report channel is gone", async () => {
    stubs.fetchChannelForDelivery.mockResolvedValue(null);
    await reconcileMvpTallyRefresh(key, db, async (input, client) =>
      refreshMvpTallyMessages(input, client),
    );
    const row = await db.matchMvpTallyRefresh.findUniqueOrThrow({ where });
    expect(row).toMatchObject({
      pending: false,
      appliedRevision: 0,
      lastErrorCode: "report-target-unavailable",
    });
    expect(row.targetProgress).toEqual({
      [`${firstChannel}:400000000000000001`]: {
        revision: 1,
        generation: 0,
        outcome: "unavailable",
      },
      [`${secondChannel}:400000000000000002`]: {
        revision: 1,
        generation: 0,
        outcome: "unavailable",
      },
    });
  });

  test("a later report target reopens a request closed for unavailable targets", async () => {
    stubs.fetchChannelForDelivery.mockResolvedValue(null);
    await reconcileMvpTallyRefresh(key, db, refreshWithoutEdit);
    const newChannel = DiscordChannelIdSchema.parse("300000000000000003");
    await recordMatchMvpOwnedReportRef(
      {
        matchId,
        serverId,
        channelId: newChannel,
        messageId: "400000000000000003",
      },
      db,
    );
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ pending: true, requeueGeneration: 1 });
    stubs.fetchChannelForDelivery.mockImplementation(
      async (channelId: string) =>
        channelId === newChannel
          ? {
              guildId: serverId,
              isTextBased: () => true,
              messages: { fetch: async () => ({ embeds: [] }) },
            }
          : null,
    );
    await reconcileMvpTallyRefresh(key, db, refreshWithoutEdit);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: false,
      appliedRevision: 1,
      lastErrorCode: null,
    });
  });

  test("closes when Discord denies access to every owned report", async () => {
    stubs.fetchChannelForDelivery.mockRejectedValue(
      Object.assign(new Error("Missing Access"), { code: 50_001 }),
    );
    await reconcileMvpTallyRefresh(key, db, async (input, client) =>
      refreshMvpTallyMessages(input, client),
    );
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: false,
      appliedRevision: 0,
      lastErrorCode: "report-target-unavailable",
    });
  });

  test("does not retire a guild for unavailable reports owned elsewhere", async () => {
    await db.matchMvpReportTarget.deleteMany({ where: { matchId, serverId } });
    await recordMatchMvpOwnedReportRef(
      {
        matchId,
        serverId: DiscordGuildIdSchema.parse("1337623164146155594"),
        channelId: firstChannel,
        messageId: "400000000000000001",
      },
      db,
    );
    stubs.fetchChannelForDelivery.mockResolvedValue(null);
    await reconcileMvpTallyRefresh(key, db, async (input, client) =>
      refreshMvpTallyMessages(input, client),
    );
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: true,
      lastErrorCode: "awaiting-report",
    });
  });
});

describe("MVP message refresh", () => {
  test("does not restore an older owned message over a newer report in the same channel", async () => {
    const latestMessageId = "400000000000000099";
    await recordMatchMvpOwnedReportRef(
      {
        matchId,
        serverId,
        channelId: firstChannel,
        messageId: latestMessageId,
      },
      db,
    );
    stubs.fetchChannelForDelivery.mockImplementation(async () => ({
      guildId: serverId,
      isTextBased: () => true,
      messages: {
        fetch: async (messageId: string) => {
          if (messageId === "400000000000000001") {
            throw Object.assign(new Error("Unknown Message"), { code: 10_008 });
          }
          return { embeds: [] };
        },
      },
    }));

    await reconcileMvpTallyRefresh(key, db, refreshWithoutEdit);

    const contest = await db.matchMvpContest.findUniqueOrThrow({
      where: { matchId },
    });
    expect(contest.reportMessageIds).toMatchObject({
      [firstChannel]: latestMessageId,
    });
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ pending: false, appliedRevision: 1 });
  });

  test.each([
    "missing response",
    "unknown channel error",
    "unknown message error",
    "deleted during edit",
    "missing access error",
    "missing permissions during edit",
  ] as const)(
    "updates live reports when another target is deleted (%s)",
    async (missingMode) => {
      stubs.fetchChannelForDelivery.mockImplementation(
        async (channelId: string) => {
          if (channelId === firstChannel) {
            if (missingMode === "missing response") return null;
            if (missingMode === "unknown channel error") {
              throw Object.assign(new Error("Unknown Channel"), {
                code: 10_003,
              });
            }
            if (missingMode === "missing access error") {
              throw Object.assign(new Error("Missing Access"), {
                code: 50_001,
              });
            }
          }
          return {
            guildId: serverId,
            isTextBased: () => true,
            messages: {
              fetch: async () => {
                if (
                  missingMode === "unknown message error" &&
                  channelId === firstChannel
                ) {
                  throw Object.assign(new Error("Unknown Message"), {
                    code: 10_008,
                  });
                }
                return { embeds: [] };
              },
            },
          };
        },
      );
      const edits: string[] = [];

      await reconcileMvpTallyRefresh(key, db, async (input, client) =>
        refreshMvpTallyMessages(input, client, async (target) => {
          if (
            missingMode === "deleted during edit" &&
            target.channelId === firstChannel
          ) {
            throw Object.assign(new Error("Unknown Message"), {
              code: 10_008,
            });
          }
          if (
            missingMode === "missing permissions during edit" &&
            target.channelId === firstChannel
          ) {
            throw Object.assign(new Error("Missing Permissions"), {
              code: 50_013,
            });
          }
          edits.push(target.messageId);
        }),
      );

      expect(edits).toEqual(["400000000000000002"]);
      await expect(
        db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
      ).resolves.toMatchObject({
        pending: false,
        appliedRevision: 1,
        lastErrorCode: null,
      });
    },
  );

  test("retries every target after a partial Discord edit", async () => {
    const edits: string[] = [];
    let failSecond = true;
    await reconcileMvpTallyRefresh(key, db, async (input, client) =>
      refreshMvpTallyMessages(input, client, async (target) => {
        edits.push(target.messageId);
        if (failSecond && target.channelId === secondChannel) {
          throw new Error("Discord reply lost");
        }
      }),
    );
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: true,
      appliedRevision: 0,
      lastErrorCode: "discord-edit-unknown",
    });

    failSecond = false;
    await db.matchMvpTallyRefresh.update({
      where,
      data: { nextAttemptAt: new Date(0) },
    });
    await reconcileMvpTallyRefresh(key, db, async (input, client) =>
      refreshMvpTallyMessages(input, client, async (target) => {
        edits.push(target.messageId);
      }),
    );
    expect(edits).toEqual([
      "400000000000000001",
      "400000000000000002",
      "400000000000000002",
    ]);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: false,
      appliedRevision: 1,
      lastErrorCode: null,
    });
  });

  test("a late report target reopens an applied tally", async () => {
    const edits: string[] = [];
    const refresh = async (
      input: Parameters<typeof refreshMvpTallyMessages>[0],
      client: Parameters<typeof refreshMvpTallyMessages>[1],
    ) =>
      refreshMvpTallyMessages(input, client, async (target) => {
        edits.push(target.messageId);
      });
    await reconcileMvpTallyRefresh(key, db, refresh);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: false,
      appliedRevision: 1,
    });

    await recordMatchMvpReportRefs(
      matchId,
      new Map([
        [
          DiscordChannelIdSchema.parse("300000000000000003"),
          "400000000000000003",
        ],
      ]),
      db,
    );
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: true,
      requeueGeneration: 1,
    });
    await reconcileMvpTallyRefresh(key, db, refresh);
    expect(edits).toEqual([
      "400000000000000001",
      "400000000000000002",
      "400000000000000001",
      "400000000000000002",
      "400000000000000003",
    ]);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: false,
      appliedRevision: 1,
    });
  });
});
