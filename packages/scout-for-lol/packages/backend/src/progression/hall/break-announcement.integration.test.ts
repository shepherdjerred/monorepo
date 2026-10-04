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
import type { HallAnnouncementDelivery } from "#src/progression/hall/break-announcement.ts";

/**
 * Where a Hall record break is announced, against real rows.
 *
 * Every case runs the production decision (`announceHallRecordBreak`) over a
 * real observation and intent table: a silent match announces nothing, the
 * key survives a channel change, and a different payload under a standing key
 * is refused. The fan-out case proves the minted intent is
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
    channelId: string;
    records: ReturnType<typeof hallBreakRecords>;
    delivery: HallAnnouncementDelivery;
  }> = {},
) {
  return announceHallRecordBreak(prisma, {
    guildId: GUILD,
    matchId,
    channelId: overrides.channelId ?? CHANNEL,
    records:
      overrides.records ??
      hallBreakRecords(2, RiotMatchIdSchema.parse(matchId)),
    delivery: overrides.delivery ?? { kind: "temporal-v2" },
    now: NOW,
  });
}

function keyOf(matchId: string) {
  return NotificationIntentKeySchema.parse(
    hallRecordBreakIntentKey(RiotMatchIdSchema.parse(matchId), GUILD),
  );
}

async function intentRows(matchId: string) {
  return await prisma.matchNotificationIntent.findMany({
    where: { riotMatchId: matchId },
  });
}

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a live match", () => {
  test("legacy live delivery can mint after its observation dual-write succeeds", async () => {
    const matchId = await observedMatch();

    expect(
      await announce(matchId, {
        delivery: { kind: "legacy-v1", silent: false },
      }),
    ).toBe("intent-minted");

    expect(await intentRows(matchId)).toHaveLength(1);
  });

  test("mints one pending hall intent", async () => {
    const matchId = await observedMatch();

    expect(await announce(matchId)).toBe("intent-minted");

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

describe("a silent or backfilled match", () => {
  test("announces nothing", async () => {
    const matchId = await observedMatch("silent-backfill");

    expect(await announce(matchId)).toBe("silent");

    expect(await intentRows(matchId)).toEqual([]);
  });

  test("legacy live delivery of a backfilled observation announces nothing", async () => {
    const matchId = await observedMatch("silent-backfill");

    expect(
      await announce(matchId, {
        delivery: { kind: "legacy-v1", silent: false },
      }),
    ).toBe("silent");

    expect(await intentRows(matchId)).toEqual([]);
  });

  test("a match with no observation is a broken contract, not a default", async () => {
    await expect(announce("NA1_4799999")).rejects.toThrow(/no observation/u);
  });

  test("legacy live delivery without an observation announces nothing", async () => {
    const matchId = "NA1_4799998";

    expect(
      await announce(matchId, {
        delivery: { kind: "legacy-v1", silent: false },
      }),
    ).toBe("silent");

    expect(await intentRows(matchId)).toEqual([]);
  });

  test("legacy silent delivery stays silent without an observation", async () => {
    const matchId = "NA1_4799997";

    expect(
      await announce(matchId, {
        delivery: { kind: "legacy-v1", silent: true },
      }),
    ).toBe("silent");

    expect(await intentRows(matchId)).toEqual([]);
  });
});
