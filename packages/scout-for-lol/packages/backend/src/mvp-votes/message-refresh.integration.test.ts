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
  await db.matchMvpVote.deleteMany();
  await db.matchMvpContest.deleteMany();
  await db.matchMvpContest.create({
    data: { matchId, roster: freezeMvpTestRoster(matchId) },
  });
  await recordMatchMvpReportRefs(
    matchId,
    new Map([
      [firstChannel, "400000000000000001"],
      [secondChannel, "400000000000000002"],
    ]),
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

describe("MVP message refresh", () => {
  test.each([
    "missing response",
    "unknown channel error",
    "unknown message error",
    "deleted during edit",
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
