import { afterAll, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  getIntent,
  listIntentsForMatch,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  deliveryIntentKey,
  prematchDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { mintPrematchIntent } from "#src/temporal/v2/prematch/prematch-intents.ts";

const { prisma } = createTestDatabase("scout-v2-prematch-intents");

afterAll(async () => {
  await prisma.$disconnect();
});

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9101");
const CHANNEL = "100000000000000001";
const OBSERVED_AT = new Date("2026-09-13T00:00:00.000Z");
const FRESHNESS_DEADLINE = new Date("2026-09-13T03:00:00.000Z");

function mint(channelId: string, createdAt: Date) {
  return mintPrematchIntent(prisma, {
    matchId: MATCH_ID,
    channelId,
    createdAt,
    freshnessDeadline: new Date(
      createdAt.getTime() +
        (FRESHNESS_DEADLINE.getTime() - OBSERVED_AT.getTime()),
    ),
  });
}

describe("mintPrematchIntent", () => {
  test("mints one pending row under the key v1's recorder would build", async () => {
    expect(await mint(CHANNEL, OBSERVED_AT)).toBe("minted");

    // The key format is shared with v1 on purpose: both pipelines mint against
    // the same channel while the rollout runs, and two spellings would mean
    // two rows and one channel told twice.
    const key = NotificationIntentKeySchema.parse(
      deliveryIntentKey(prematchDeliveryKeyPrefix(MATCH_ID), CHANNEL),
    );
    const stored = await getIntent(prisma, { intentKey: key });
    expect(stored?.matchId).toBe(MATCH_ID);
    expect(stored?.intent.state).toEqual({ kind: "pending" });
    expect(stored?.intent.attemptCount).toBe(0);
    expect(stored?.intent.target).toEqual({
      kind: "channel",
      channelId: CHANNEL,
    });
  });

  test("finds its own row on a retry instead of conflicting with it", async () => {
    const channel = "100000000000000002";
    expect(await mint(channel, OBSERVED_AT)).toBe("minted");

    // A retried Activity runs on a later clock. `upsertIntent` compares the
    // WHOLE stored row, so writing again would be answered `intent-differs` —
    // a drift signal raised by the system working correctly. The read-first
    // gate is what keeps an ordinary retry from producing one.
    const laterAttempt = new Date(OBSERVED_AT.getTime() + 45_000);
    expect(await mint(channel, laterAttempt)).toBe("existing");

    const key = NotificationIntentKeySchema.parse(
      deliveryIntentKey(prematchDeliveryKeyPrefix(MATCH_ID), channel),
    );
    const stored = await getIntent(prisma, { intentKey: key });
    // The first attempt's row stands, unmoved.
    expect(stored?.intent.createdAt).toBe(OBSERVED_AT.toISOString());
    expect(stored?.intent.state).toEqual({ kind: "pending" });
  });

  test("refuses a standing row under this key that names another game", async () => {
    // The key is derived from the match and the channel, but every reader
    // uses the row's own columns: the fan-out selects by match, the send goes
    // to the target. A row under this key naming a different match would be
    // accepted as "already minted" and then never found for this game — the
    // channel silently never told. That is a broken contract, and it fails.
    const channel = "100000000000000009";
    const key = NotificationIntentKeySchema.parse(
      deliveryIntentKey(prematchDeliveryKeyPrefix(MATCH_ID), channel),
    );
    expect(
      await upsertIntent(prisma, {
        matchId: RiotMatchIdSchema.parse("NA1_9199"),
        intent: {
          key,
          // The rival row is a well-formed prematch intent in every respect
          // but the match it names; that is the whole point of the test.
          kind: "prematch",
          origin: { kind: "live" },
          target: {
            kind: "channel",
            channelId: DiscordChannelIdSchema.parse(channel),
          },
          freshnessDeadline: IsoInstantSchema.parse(
            FRESHNESS_DEADLINE.toISOString(),
          ),
          createdAt: IsoInstantSchema.parse(OBSERVED_AT.toISOString()),
          attemptCount: 0,
          state: { kind: "pending" },
        },
      }),
    ).toEqual({ outcome: "applied" });

    await expect(mint(channel, OBSERVED_AT)).rejects.toThrow(
      /refusing to treat it as this game's instruction/,
    );
  });

  test("keeps one row per channel for one game", async () => {
    const channels = ["100000000000000003", "100000000000000004"];
    for (const channel of channels) {
      expect(await mint(channel, OBSERVED_AT)).toBe("minted");
      expect(await mint(channel, OBSERVED_AT)).toBe("existing");
    }

    const prefix = `${prematchDeliveryKeyPrefix(MATCH_ID)}:`;
    const stored = await listIntentsForMatch(prisma, { matchId: MATCH_ID });
    const minted = stored
      .map((record) => record.intent.key)
      .filter((key) => key.startsWith(prefix));
    expect(new Set(minted).size).toBe(minted.length);
    expect(minted).toEqual(
      expect.arrayContaining(channels.map((channel) => `${prefix}${channel}`)),
    );
  });
});
