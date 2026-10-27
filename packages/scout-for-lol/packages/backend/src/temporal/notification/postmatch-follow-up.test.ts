import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  DiscordMessageIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordGuildIdSchema,
  type DiscordChannelId,
  DiscordChannelIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  NotificationIntentSchema,
  NotificationIntentStateSchema,
  type NotificationIntentState,
} from "@scout-for-lol/domain/notifications/intent.ts";
import { receiptScopeKey } from "@scout-for-lol/domain/match-processing/states.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import type { MatchProcessingReceiptRecord } from "#src/database/durable/receipt-row.ts";

/**
 * An in-memory receipt table with the property the follow-up rests on: one
 * identity `(match, kind, version, scope)` is recorded once, a repeat with the
 * same evidence answers `already-applied`, and different evidence `conflict`.
 */
const receipts = vi.hoisted(() => {
  const rows = new Map<string, string | null>();
  return {
    rows,
    record: vi.fn<(db: unknown, record: unknown) => void>(),
  };
});

function identity(record: MatchProcessingReceiptRecord): string {
  return [
    record.matchId,
    record.receipt.kind,
    String(record.receipt.version),
    receiptScopeKey(record.receipt.scope),
  ].join("|");
}

const stubs = vi.hoisted(() => ({
  subscriptionGuildOfChannel: vi.fn(),
  recordCoreOutputsDelivered: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({ prisma: {} }));
vi.mock("#src/database/durable/receipt-repository.ts", () => ({
  recordReceipt: async (db: unknown, record: MatchProcessingReceiptRecord) => {
    receipts.record(db, record);
    // Yield first so two concurrent writers really do interleave.
    await Promise.resolve();
    const key = identity(record);
    const standing = receipts.rows.get(key);
    if (standing === undefined) {
      receipts.rows.set(key, record.evidence);
      return { outcome: "applied" };
    }
    return standing === record.evidence
      ? { outcome: "already-applied" }
      : { outcome: "conflict", reason: "receipt-evidence-mismatch" };
  },
}));
vi.mock("#src/temporal/notification/subscription-guild.ts", () => ({
  subscriptionGuildOfChannel: stubs.subscriptionGuildOfChannel,
}));
vi.mock("#src/analytics/guild-lifecycle.ts", () => ({
  recordCoreOutputsDelivered: stubs.recordCoreOutputsDelivered,
}));

const { afterPostmatchDelivered, POSTMATCH_CORE_OUTPUT_RECEIPT_KIND } =
  await import("#src/temporal/notification/postmatch-follow-up.ts");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9301");
const CHANNEL_ID = DiscordChannelIdSchema.parse("300000000000000001");
const SIBLING_CHANNEL_ID = DiscordChannelIdSchema.parse("300000000000000002");
const GUILD_ID = DiscordGuildIdSchema.parse("100000000000000001");
const OTHER_GUILD_ID = DiscordGuildIdSchema.parse("100000000000000002");

const DELIVERED = NotificationIntentStateSchema.parse({
  kind: "delivered",
  deliveredAt: "2026-09-17T00:05:00.000Z",
  messageId: DiscordMessageIdSchema.parse("400000000000000777"),
});

function postmatchRecord(
  state: NotificationIntentState,
  channelId: DiscordChannelId = CHANNEL_ID,
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
  receipts.rows.clear();
  stubs.subscriptionGuildOfChannel.mockResolvedValue(GUILD_ID);
  stubs.recordCoreOutputsDelivered.mockResolvedValue(undefined);
});

describe("the post-match follow-up", () => {
  test("counts the delivered report against its channel's guild, under a guild-scoped receipt", async () => {
    await afterPostmatchDelivered(postmatchRecord(DELIVERED));

    expect(stubs.subscriptionGuildOfChannel).toHaveBeenCalledWith(CHANNEL_ID);
    expect(stubs.recordCoreOutputsDelivered).toHaveBeenCalledWith(
      [GUILD_ID],
      "postmatch",
    );
    expect(receipts.record).toHaveBeenCalledTimes(1);
    expect(receipts.record.mock.calls[0]?.[1]).toMatchObject({
      matchId: MATCH_ID,
      receipt: {
        kind: POSTMATCH_CORE_OUTPUT_RECEIPT_KIND,
        scope: { kind: "guild", guildId: GUILD_ID },
      },
    });
  });

  test("counts a guild once when two of its channels deliver the same report", async () => {
    // v1 counted each guild a report reached once per delivery pass. V2's
    // sibling channels finish moments apart, including at the same moment.
    await Promise.all([
      afterPostmatchDelivered(postmatchRecord(DELIVERED, CHANNEL_ID)),
      afterPostmatchDelivered(postmatchRecord(DELIVERED, SIBLING_CHANNEL_ID)),
    ]);
    // A retry of either follow-up after the fact counts nothing more.
    await afterPostmatchDelivered(postmatchRecord(DELIVERED, CHANNEL_ID));

    expect(stubs.recordCoreOutputsDelivered).toHaveBeenCalledTimes(1);
    expect(receipts.record).toHaveBeenCalledTimes(3);
    expect(receipts.rows.size).toBe(1);
  });

  test("counts each guild a report reached separately", async () => {
    stubs.subscriptionGuildOfChannel.mockImplementation((channelId) =>
      Promise.resolve(channelId === CHANNEL_ID ? GUILD_ID : OTHER_GUILD_ID),
    );

    await afterPostmatchDelivered(postmatchRecord(DELIVERED, CHANNEL_ID));
    await afterPostmatchDelivered(
      postmatchRecord(DELIVERED, SIBLING_CHANNEL_ID),
    );

    expect(stubs.recordCoreOutputsDelivered).toHaveBeenCalledTimes(2);
    expect(receipts.rows.size).toBe(2);
  });

  test("counts nothing for a channel no subscription names any more", async () => {
    stubs.subscriptionGuildOfChannel.mockResolvedValue(null);

    await afterPostmatchDelivered(postmatchRecord(DELIVERED));

    expect(receipts.record).not.toHaveBeenCalled();
    expect(stubs.recordCoreOutputsDelivered).not.toHaveBeenCalled();
  });

  test("counts nothing for a report that was not delivered", async () => {
    await afterPostmatchDelivered(
      postmatchRecord(NotificationIntentStateSchema.parse({ kind: "ready" })),
    );

    expect(stubs.subscriptionGuildOfChannel).not.toHaveBeenCalled();
    expect(stubs.recordCoreOutputsDelivered).not.toHaveBeenCalled();
  });
});
