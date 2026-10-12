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
  type RiotMatchId,
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
 * else — the record lock, the cell comparison, the transaction and the intent
 * mint — is production code. This is what proves the silent gate is on the
 * evaluator's own path rather than only on the helper's.
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
    rows: unknown[];
  } => ({
    rows: [],
  }),
);

vi.mock("#src/configuration/flags.ts", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  );
  return {
    ...actual,
    isPolicyEnabled: (name: string) =>
      Promise.resolve(name === "hall_of_fame_enabled"),
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

function row(matchId: RiotMatchId): ProgressionMatchRow {
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
function rawMatch(matchId: RiotMatchId): RawMatch {
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
    matchDataSource: "RIOT",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-19T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-19T09:31:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
  stubs.rows = [row(matchId)];
  return matchId;
}

beforeEach(async () => {
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
  test("mints the hall intent for a live match", async () => {
    const matchId = await observedMatch("live");

    await evaluateHallMatch(rawMatch(RiotMatchIdSchema.parse(matchId)));

    const intents = await prisma.matchNotificationIntent.findMany();
    expect(intents.map((intent) => intent.intentKey)).toEqual([
      `hall-record-break:${matchId}:${GUILD}`,
    ]);
    expect(intents[0]).toMatchObject({
      kind: "hall-record-break",
      targetId: CHANNEL,
      state: "pending",
    });
  });

  test("a silent backfill updates the records but announces nothing", async () => {
    const matchId = await observedMatch("silent-backfill");

    await evaluateHallMatch(rawMatch(RiotMatchIdSchema.parse(matchId)));

    // The record itself is still broken: silence is about the message.
    const cells = await prisma.hallRecordCell.findMany();
    expect(cells.map((cell) => cell.currentValue)).toEqual([30]);
    expect(await prisma.matchNotificationIntent.count()).toBe(0);
  });

  test("re-evaluating the same match announces nothing new", async () => {
    const matchId = await observedMatch("live");
    await evaluateHallMatch(rawMatch(RiotMatchIdSchema.parse(matchId)));

    // A retried progression Activity: the cells already hold this match, so
    // nothing breaks again and no second intent appears.
    await evaluateHallMatch(rawMatch(RiotMatchIdSchema.parse(matchId)));

    expect(await prisma.matchNotificationIntent.count()).toBe(1);
  });
});
