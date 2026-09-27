import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  COMPETITIVE_PROGRESSION_CATALOG_VERSION,
  HallSettingsSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import type * as DatabaseModule from "#src/database/index.ts";
import type { ProgressionMatchRow } from "#src/progression/progression-lake-reads.ts";
import { loadRawMatchFixture } from "#src/testing/raw-capture-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

/**
 * The Hall evaluator's announcement, end to end over real rows.
 *
 * Only the two things that leave the database are stubbed: the lake read
 * that supplies the match's per-player row, and the flag provider. Everything
 * else — the record lock, the cell comparison, the transaction, the path
 * decision and the V2 mint — is production code. This is what proves the flag
 * is read per server and reaches the decision, and that the silent gate is on
 * the evaluator's own path rather than only on the helper's.
 */

const { prisma } = createTestDatabase("scout-hall-evaluate-match");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const stubs = vi.hoisted(
  (): {
    v2Enabled: boolean;
    rows: unknown[];
    flagCalls: { name: string; server: unknown }[];
  } => ({
    v2Enabled: false,
    rows: [],
    flagCalls: [],
  }),
);

vi.mock("#src/configuration/flags.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  );
  return {
    ...actual,
    isPolicyEnabled: (name: string, context: { server?: unknown }) => {
      stubs.flagCalls.push({ name, server: context.server });
      return Promise.resolve(
        name === "scout_v2_progression_notifications_enabled"
          ? stubs.v2Enabled
          : name === "hall_of_fame_enabled",
      );
    },
  };
});
vi.mock("#src/progression/progression-lake-reads.ts", () => ({
  fetchProgressionMatches: () => Promise.resolve(stubs.rows),
}));

const { evaluateHallMatch } =
  await import("#src/progression/hall/evaluate-match.ts");
const { updateHallSettings } =
  await import("#src/progression/hall/settings.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");

const GUILD = testGuildId("4800");
const CHANNEL = testChannelId("4801");
const PUUID = testPuuid("hall-evaluate-1");

function rankedQueue(): ProgressionMatchRow["queue"] {
  const family = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies.find(
    (candidate) => candidate.id === "ranked_sr",
  );
  const queue = family?.queues[0];
  if (queue === undefined) throw new Error("ranked_sr has no queue");
  return queue;
}

function row(matchId: string): ProgressionMatchRow {
  return {
    match_id: matchId,
    game_end_at: "2026-09-19T09:30:00.000Z",
    game_end_ms: Date.parse("2026-09-19T09:30:00.000Z"),
    game_duration_seconds: 1800,
    queue: rankedQueue(),
    end_of_game_result: "GameComplete",
    early_surrendered: false,
    puuid: PUUID,
    champion_id: 1,
    champion_name: "Annie",
    team_position: "MIDDLE",
    win: true,
    kills: 30,
    deaths: 1,
    assists: 20,
    creep_score: 200,
    gold_earned: 15_000,
    total_damage_dealt_to_champions: 40_000,
    total_damage_taken: 10_000,
    damage_self_mitigated: 5000,
    total_heals_on_teammates: 0,
    vision_score: 30,
    wards_killed: 5,
    damage_dealt_to_objectives: 8000,
    damage_dealt_to_turrets: 4000,
    time_ccing_others: 20,
    longest_time_spent_living: 900,
    total_time_spent_dead: 30,
    penta_kills: 0,
    placement: null,
    timeline_complete: true,
  };
}

const FIXTURE = await loadRawMatchFixture();

/** The evaluator reads only the metadata before the lake row takes over. */
function rawMatch(matchId: string): RawMatch {
  return {
    ...FIXTURE,
    metadata: { ...FIXTURE.metadata, matchId, participants: [PUUID] },
  };
}

let seq = 0;

async function observedMatch(
  deliveryMode: "live" | "silent-backfill",
): Promise<string> {
  seq += 1;
  const matchId = RiotMatchIdSchema.parse(
    `NA1_48${String(seq).padStart(3, "0")}`,
  );
  await observeMatch(prisma, {
    matchId,
    platformRoute: PlatformRouteSchema.parse("NA1"),
    policy: "FULL",
    deliveryMode,
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-19T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-19T09:31:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
  stubs.rows = [row(matchId)];
  return matchId;
}

function unobservedMatch(): string {
  seq += 1;
  const matchId = RiotMatchIdSchema.parse(
    `NA1_48${String(seq).padStart(3, "0")}`,
  );
  stubs.rows = [row(matchId)];
  return matchId;
}

beforeEach(async () => {
  stubs.flagCalls = [];
  await prisma.hallRecordBreakOutbox.deleteMany();
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.hallRecordCell.deleteMany();
  await prisma.hallBaselineRun.deleteMany();
  await prisma.hallSettings.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  const now = new Date("2026-09-01T00:00:00.000Z");
  const player = await prisma.player.create({
    data: {
      alias: "Alice",
      serverId: GUILD,
      creatorDiscordId: testAccountId("4800"),
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.account.create({
    data: {
      alias: "Main",
      puuid: PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: GUILD,
      creatorDiscordId: testAccountId("4800"),
      createdTime: now,
      updatedTime: now,
    },
  });
  await updateHallSettings(prisma, {
    settings: HallSettingsSchema.parse({
      guildId: GUILD,
      catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
      channelId: CHANNEL,
      enabledQueueFamilies: ["ranked_sr"],
      enabledRecords: ["kills"],
    }),
    actorDiscordId: testAccountId("4800"),
    stage: "beta",
  });
  // A finished baseline with nothing recorded yet: the match breaks it.
  await prisma.hallRecordCell.updateMany({
    data: { baselineStatus: "ready", currentValue: null },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("evaluateHallMatch's announcement", () => {
  test("mints the V2 intent, and no outbox row, when the guild has the V2 path on", async () => {
    stubs.v2Enabled = true;
    const matchId = await observedMatch("live");

    await evaluateHallMatch(rawMatch(matchId), { kind: "temporal-v2" });

    const intents = await prisma.matchNotificationIntent.findMany();
    expect(intents.map((intent) => intent.intentKey)).toEqual([
      `hall-record-break:${matchId}:${GUILD}`,
    ]);
    expect(intents[0]).toMatchObject({
      kind: "hall-record-break",
      targetId: CHANNEL,
      state: "pending",
    });
    expect(await prisma.hallRecordBreakOutbox.count()).toBe(0);
    expect(stubs.flagCalls).toContainEqual({
      name: "scout_v2_progression_notifications_enabled",
      server: GUILD,
    });
  });

  test("writes v1's outbox row when the guild has the V2 path off", async () => {
    stubs.v2Enabled = false;
    const matchId = await observedMatch("live");

    await evaluateHallMatch(rawMatch(matchId), { kind: "temporal-v2" });

    expect(await prisma.matchNotificationIntent.count()).toBe(0);
    expect(
      await prisma.hallRecordBreakOutbox.findMany({
        select: { guildId: true, matchId: true, channelId: true },
      }),
    ).toEqual([{ guildId: GUILD, matchId, channelId: CHANNEL }]);
  });

  test("keeps legacy ingestion on the outbox when its observation dual-write failed", async () => {
    stubs.v2Enabled = true;
    const matchId = unobservedMatch();

    await evaluateHallMatch(rawMatch(matchId), {
      kind: "legacy-v1",
      silent: false,
    });

    expect(await prisma.matchNotificationIntent.count()).toBe(0);
    expect(
      await prisma.hallRecordBreakOutbox.findMany({
        select: { guildId: true, matchId: true, channelId: true },
      }),
    ).toEqual([{ guildId: GUILD, matchId, channelId: CHANNEL }]);
  });

  test.each([true, false])(
    "a silent backfill updates the records but announces nothing (V2 on: %s)",
    async (v2Enabled) => {
      stubs.v2Enabled = v2Enabled;
      const matchId = await observedMatch("silent-backfill");

      await evaluateHallMatch(rawMatch(matchId), { kind: "temporal-v2" });

      // The record itself is still broken: silence is about the message.
      const cells = await prisma.hallRecordCell.findMany();
      expect(cells.map((cell) => cell.currentValue)).toEqual([30]);
      expect(await prisma.matchNotificationIntent.count()).toBe(0);
      expect(await prisma.hallRecordBreakOutbox.count()).toBe(0);
    },
  );

  test("re-evaluating the same match announces nothing new", async () => {
    stubs.v2Enabled = true;
    const matchId = await observedMatch("live");
    await evaluateHallMatch(rawMatch(matchId), { kind: "temporal-v2" });

    // A retried progression Activity: the cells already hold this match, so
    // nothing breaks again and no second intent or outbox row appears.
    await evaluateHallMatch(rawMatch(matchId), { kind: "temporal-v2" });

    expect(await prisma.matchNotificationIntent.count()).toBe(1);
    expect(await prisma.hallRecordBreakOutbox.count()).toBe(0);
  });
});
