import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  NotificationIntentSchema,
  NotificationIntentStateSchema,
  type NotificationIntentState,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";

/**
 * An in-memory `ScoutEffectClaim` table with the one property the claim
 * protocol rests on: a second insert of a key fails as Prisma's unique
 * violation does.
 */
const claims = vi.hoisted(() => {
  const rows = new Map<string, { key: string; kind: string; state: string }>();
  return {
    rows,
    create: vi.fn((args: { data: { key: string; kind: string } }) => {
      if (rows.has(args.data.key)) {
        return Promise.reject(
          Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          }),
        );
      }
      rows.set(args.data.key, { ...args.data, state: "CLAIMED" });
      return Promise.resolve(undefined);
    }),
    findUniqueOrThrow: vi.fn((args: { where: { key: string } }) => {
      const row = rows.get(args.where.key);
      return row === undefined
        ? Promise.reject(new Error(`No claim ${args.where.key}`))
        : Promise.resolve(row);
    }),
    update: vi.fn(
      (args: { where: { key: string }; data: { state: string } }) => {
        const row = rows.get(args.where.key);
        if (row !== undefined) row.state = args.data.state;
        return Promise.resolve(undefined);
      },
    ),
  };
});

const stubs = vi.hoisted(() => ({
  prematchGuildOfChannel: vi.fn(),
  recordCoreOutputsDelivered: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutEffectClaim: {
      create: claims.create,
      findUniqueOrThrow: claims.findUniqueOrThrow,
      update: claims.update,
    },
  },
}));
vi.mock("#src/temporal/v2/prematch/prematch-markets.ts", () => ({
  prematchGuildOfChannel: stubs.prematchGuildOfChannel,
}));
vi.mock("#src/analytics/guild-lifecycle.ts", () => ({
  recordCoreOutputsDelivered: stubs.recordCoreOutputsDelivered,
}));

const { afterPostmatchDeliveredV2 } =
  await import("#src/temporal/v2/notification/postmatch-follow-up.ts");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9301");
const CHANNEL_ID = "300000000000000001";
const SIBLING_CHANNEL_ID = "300000000000000002";
const GUILD_ID = DiscordGuildIdSchema.parse("100000000000000001");
const CLAIM_KEY = `core-output:postmatch:${MATCH_ID}:${GUILD_ID}`;

const DELIVERED = NotificationIntentStateSchema.parse({
  kind: "delivered",
  deliveredAt: "2026-09-17T00:05:00.000Z",
  messageId: "400000000000000777",
});

function postmatchRecord(
  state: NotificationIntentState,
  channelId: string = CHANNEL_ID,
): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: NotificationIntentSchema.parse({
      key: NotificationIntentKeySchema.parse(
        `postmatch-discord:${MATCH_ID}:${channelId}`,
      ),
      kind: "postmatch",
      origin: { kind: "live" },
      target: { kind: "channel", channelId },
      freshnessDeadline: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-09-17T00:00:00.000Z",
      attemptCount: state.kind === "delivered" ? 1 : 0,
      state,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  claims.rows.clear();
  stubs.prematchGuildOfChannel.mockResolvedValue(GUILD_ID);
  stubs.recordCoreOutputsDelivered.mockResolvedValue(undefined);
});

describe("the post-match follow-up", () => {
  test("counts the delivered report against its channel's guild, under a claim", async () => {
    await afterPostmatchDeliveredV2(postmatchRecord(DELIVERED));

    expect(stubs.prematchGuildOfChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(stubs.recordCoreOutputsDelivered).toHaveBeenCalledWith(
      [GUILD_ID],
      "postmatch",
    );
    expect(claims.rows.get(CLAIM_KEY)).toEqual({
      key: CLAIM_KEY,
      kind: "core-output-postmatch",
      state: "COMPLETED",
    });
  });

  test("counts a guild once when two of its channels deliver the same report", async () => {
    // v1 counted each guild a report reached once per delivery pass. V2's
    // sibling channels finish moments apart, including at the same moment.
    await Promise.all([
      afterPostmatchDeliveredV2(postmatchRecord(DELIVERED, CHANNEL_ID)),
      afterPostmatchDeliveredV2(postmatchRecord(DELIVERED, SIBLING_CHANNEL_ID)),
    ]);
    // A retry of either follow-up after the fact counts nothing more.
    await afterPostmatchDeliveredV2(postmatchRecord(DELIVERED, CHANNEL_ID));

    expect(stubs.recordCoreOutputsDelivered).toHaveBeenCalledTimes(1);
    expect(claims.create).toHaveBeenCalledTimes(3);
  });

  test("counts nothing for a channel no subscription names any more", async () => {
    stubs.prematchGuildOfChannel.mockResolvedValue(null);

    await afterPostmatchDeliveredV2(postmatchRecord(DELIVERED));

    expect(claims.create).not.toHaveBeenCalled();
    expect(stubs.recordCoreOutputsDelivered).not.toHaveBeenCalled();
  });

  test("counts nothing for a report that was not delivered", async () => {
    await afterPostmatchDeliveredV2(
      postmatchRecord(NotificationIntentStateSchema.parse({ kind: "ready" })),
    );

    expect(stubs.prematchGuildOfChannel).not.toHaveBeenCalled();
    expect(stubs.recordCoreOutputsDelivered).not.toHaveBeenCalled();
  });
});
