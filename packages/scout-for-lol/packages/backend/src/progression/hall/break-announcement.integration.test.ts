import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";
import { hallBreakRecords } from "#src/temporal/v2/notification/hall-record-break.test-fixtures.ts";

/**
 * Where a Hall record break is announced, against real rows.
 *
 * Every case runs the production decision (`announceHallRecordBreak`) over a
 * real observation, outbox and intent table: first path owns the identity,
 * the flag only routes a NEW announcement, a silent match announces nothing on
 * either path, the key survives a channel change, and a different payload
 * under a standing key is refused. The fan-out case proves the minted intent is
 * one the match's own post-commit fan-out starts a notification child for,
 * with no other wiring.
 */

const { prisma } = createTestDatabase("scout-hall-break-announcement");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const { announceHallRecordBreak, HALL_RECORD_BREAK_FRESHNESS_MS } =
  await import("#src/progression/hall/break-announcement.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");
const { getIntent } =
  await import("#src/database/durable/intent-repository.ts");
const { hallRecordBreakIntentKey } =
  await import("#src/durable/match/delivery-intents.ts");
const { planMatchFanOutV2 } = await import("#src/temporal/v2/match-reads.ts");

const GUILD = testGuildId("4700");
const CHANNEL = testChannelId("4701");
const OTHER_CHANNEL = testChannelId("4702");
const NOW = new Date("2026-09-19T09:35:00.000Z");

let seq = 0;

/** A match with a committed observation in the given delivery mode. */
async function observedMatch(
  deliveryMode: "live" | "silent-backfill" = "live",
): Promise<string> {
  seq += 1;
  const matchId = RiotMatchIdSchema.parse(
    `NA1_47${String(seq).padStart(3, "0")}`,
  );
  await observeMatch(prisma, {
    matchId,
    platformRoute: PlatformRouteSchema.parse("NA1"),
    policy: "FULL",
    deliveryMode,
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-19T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-19T09:30:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
  return matchId;
}

function announce(
  matchId: string,
  overrides: Partial<{
    v2Enabled: boolean;
    channelId: string;
    records: ReturnType<typeof hallBreakRecords>;
  }> = {},
) {
  return announceHallRecordBreak(prisma, {
    guildId: GUILD,
    matchId,
    channelId: overrides.channelId ?? CHANNEL,
    records:
      overrides.records ??
      hallBreakRecords(2, RiotMatchIdSchema.parse(matchId)),
    v2Enabled: overrides.v2Enabled ?? true,
    now: NOW,
  });
}

function keyOf(matchId: string) {
  return NotificationIntentKeySchema.parse(
    hallRecordBreakIntentKey(RiotMatchIdSchema.parse(matchId), GUILD),
  );
}

async function outboxRows(matchId: string) {
  return await prisma.hallRecordBreakOutbox.findMany({
    where: { guildId: GUILD, matchId },
  });
}

async function intentRows(matchId: string) {
  return await prisma.matchNotificationIntent.findMany({
    where: { riotMatchId: matchId },
  });
}

beforeEach(async () => {
  await prisma.hallRecordBreakOutbox.deleteMany();
  await prisma.matchNotificationIntent.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("with the V2 path on for the guild", () => {
  test("mints one pending hall intent and writes no outbox row", async () => {
    const matchId = await observedMatch();

    expect(await announce(matchId)).toBe("intent-minted");

    expect(await outboxRows(matchId)).toEqual([]);
    const stored = await getIntent(prisma, { intentKey: keyOf(matchId) });
    expect(stored?.matchId).toBe(matchId);
    expect(stored?.intent).toMatchObject({
      kind: "hall-record-break",
      origin: { kind: "live" },
      target: { kind: "channel", channelId: CHANNEL },
      state: { kind: "pending" },
      attemptCount: 0,
    });
    // The owner-confirmed deadline: one day past the decision.
    expect(
      Date.parse(stored?.intent.freshnessDeadline ?? "") -
        Date.parse(stored?.intent.createdAt ?? ""),
    ).toBe(HALL_RECORD_BREAK_FRESHNESS_MS);
    expect(HALL_RECORD_BREAK_FRESHNESS_MS).toBe(24 * 60 * 60 * 1000);
  });

  test("the match's own fan-out starts a notification child for it", async () => {
    const matchId = await observedMatch();
    await announce(matchId);

    const plan = await planMatchFanOutV2({ riotMatchId: matchId });

    expect(plan.notificationIntentKeys).toContain(keyOf(matchId));
  });

  test("an outbox row already standing keeps the announcement on v1", async () => {
    const matchId = await observedMatch();
    expect(await announce(matchId, { v2Enabled: false })).toBe("outbox");

    // The flag turns on after v1 took the decision: v1 keeps it, and its row
    // is upserted exactly as before (here, following a channel change).
    expect(
      await announce(matchId, { v2Enabled: true, channelId: OTHER_CHANNEL }),
    ).toBe("outbox");

    expect(await intentRows(matchId)).toEqual([]);
    const rows = await outboxRows(matchId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channelId).toBe(OTHER_CHANNEL);
    expect(JSON.parse(rows[0]?.payloadJson ?? "null")).toEqual(
      structuredClone(hallBreakRecords(2, RiotMatchIdSchema.parse(matchId))),
    );
  });

  test("a channel change re-evaluating the same break mints no second key", async () => {
    const matchId = await observedMatch();
    await announce(matchId);

    expect(await announce(matchId, { channelId: OTHER_CHANNEL })).toBe(
      "intent-standing",
    );

    const rows = await intentRows(matchId);
    expect(rows.map((row) => row.intentKey)).toEqual([keyOf(matchId)]);
    // The standing row is the decision; its target is not rewritten.
    expect(rows[0]?.targetId).toBe(CHANNEL);
    expect(await outboxRows(matchId)).toEqual([]);
  });

  test("a different payload under a standing key throws instead of choosing", async () => {
    const matchId = await observedMatch();
    await announce(matchId);

    await expect(
      announce(matchId, {
        records: hallBreakRecords(1, RiotMatchIdSchema.parse(matchId)),
      }),
    ).rejects.toThrow(/different announcement/u);
    expect(await intentRows(matchId)).toHaveLength(1);
  });
});

describe("with the V2 path off for the guild", () => {
  test("writes v1's outbox row when nothing stands", async () => {
    const matchId = await observedMatch();

    expect(await announce(matchId, { v2Enabled: false })).toBe("outbox");

    expect(await outboxRows(matchId)).toHaveLength(1);
    expect(await intentRows(matchId)).toEqual([]);
  });

  test("an intent already standing keeps the announcement on V2", async () => {
    const matchId = await observedMatch();
    await announce(matchId, { v2Enabled: true });

    // The flag was turned off after V2 took the decision: no outbox row may
    // appear beside the intent, or the guild would be told twice.
    expect(await announce(matchId, { v2Enabled: false })).toBe(
      "intent-standing",
    );

    expect(await outboxRows(matchId)).toEqual([]);
    expect(await intentRows(matchId)).toHaveLength(1);
  });
});

describe("a silent or backfilled match", () => {
  test.each([true, false])(
    "announces nothing on either path (V2 on: %s)",
    async (v2Enabled) => {
      const matchId = await observedMatch("silent-backfill");

      expect(await announce(matchId, { v2Enabled })).toBe("silent");

      expect(await outboxRows(matchId)).toEqual([]);
      expect(await intentRows(matchId)).toEqual([]);
    },
  );

  test("a match with no observation is a broken contract, not a default", async () => {
    await expect(announce("NA1_4799999")).rejects.toThrow(/no observation/u);
  });
});
