import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  AccountIdSchema,
  PlayerIdSchema,
  type LeaguePuuid,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import {
  renderReportOutput,
  type RenderedReportOutput,
} from "#src/reports/output.ts";
import { runReport } from "#src/reports/runner.ts";

// End-to-end coverage of the report DSL's declarative `RENDER` clause: real
// SQLite facts → parse → aggregate → render. This is the only suite that
// actually exercises chart rendering (echarts → SVG → PNG) in tests.
const { prisma } = createTestDatabase("report-render-test");
const serverId = testGuildId("717171");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const TITLE = "Test Report";

// Alpha: 3 solo games, 2 wins (games=3, win_rate≈0.67).
// Bravo: 1 solo game, 1 win  (games=1, win_rate=1.0).
// games and win_rate rank players in opposite orders, so the chosen Y channel
// (and ORDER BY) are observable.
async function seedFacts(): Promise<void> {
  await createFact({ player: 1, alias: "Alpha", matchId: "NA1_a1", win: true });
  await createFact({ player: 1, alias: "Alpha", matchId: "NA1_a2", win: true });
  await createFact({
    player: 1,
    alias: "Alpha",
    matchId: "NA1_a3",
    win: false,
  });
  await createFact({ player: 2, alias: "Bravo", matchId: "NA1_b1", win: true });
}

const BASE_QUERY =
  "SELECT player, games, wins, win_rate FROM match_participants WHERE queue IN ('solo') GROUP BY player ORDER BY games DESC";

async function render(queryText: string): Promise<RenderedReportOutput> {
  const result = await executeReportQuery({
    prisma,
    serverId,
    queryText,
    lookbackDays: 30,
    maxRows: 10,
    now,
  });
  return renderReportOutput({ title: TITLE, result, startedAt: now });
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("RENDER clause — text kinds", () => {
  test("RENDER table produces a markdown table, no image", async () => {
    await seedFacts();
    const output = await render(`${BASE_QUERY} RENDER table`);
    expect(output.image).toBeNull();
    expect(output.content).toContain(`**${TITLE}**`);
    expect(output.content).toContain("label | games | wins | win_rate");
    expect(output.content).toContain("Alpha");
    expect(output.content).toContain("Bravo");
  });

  test("RENDER leaderboard produces a ranked list ordered by the query", async () => {
    await seedFacts();
    const output = await render(`${BASE_QUERY} RENDER leaderboard`);
    expect(output.image).toBeNull();
    // ORDER BY games DESC → Alpha (3) before Bravo (1).
    expect(output.content).toMatch(/1\. Alpha/);
    expect(output.content).toMatch(/2\. Bravo/);
  });

  test("a query with no RENDER clause defaults to a TABLE render", async () => {
    await seedFacts();
    const output = await render(BASE_QUERY);
    expect(output.image).toBeNull();
    expect(output.content).toContain("label | games | wins | win_rate");
  });
});

describe("RENDER clause — charts", () => {
  test("RENDER bar_chart produces a PNG titled with the report title", async () => {
    await seedFacts();
    const output = await render(`${BASE_QUERY} RENDER bar_chart`);
    expect(output.image).not.toBeNull();
    expect(output.image?.filename).toBe("report-bar-chart.png");
    // A real PNG: magic header + non-trivial size.
    expect(output.image?.data.length).toBeGreaterThan(1000);
    expect(output.image?.data.subarray(1, 4).toString()).toBe("PNG");
    expect(output.content).toBe(`**${TITLE}**`);
  });

  test("RENDER line_chart also produces a PNG", async () => {
    await seedFacts();
    const output = await render(
      `${BASE_QUERY} RENDER line_chart WITH (y = win_rate)`,
    );
    expect(output.image).not.toBeNull();
    expect(output.image?.filename).toBe("report-line-chart.png");
    expect(output.image?.data.length).toBeGreaterThan(1000);
  });

  test("title option overrides the report title in the chart content", async () => {
    await seedFacts();
    const output = await render(
      `${BASE_QUERY} RENDER bar_chart WITH (y = win_rate, title = "Win Rate Leaders")`,
    );
    expect(output.content).toBe("**Win Rate Leaders**");
    expect(output.image).not.toBeNull();
  });

  test("the Y channel is load-bearing: different metrics render different charts", async () => {
    await seedFacts();
    const byGames = await render(
      `${BASE_QUERY} RENDER bar_chart WITH (y = games)`,
    );
    const byWinRate = await render(
      `${BASE_QUERY} RENDER bar_chart WITH (y = win_rate)`,
    );
    expect(byGames.image).not.toBeNull();
    expect(byWinRate.image).not.toBeNull();
    expect(
      byGames.image?.data.equals(byWinRate.image?.data ?? Buffer.alloc(0)),
    ).toBe(false);
  });

  test("a bare bar_chart defaults Y to the first SELECTed metric (back-compat)", async () => {
    await seedFacts();
    const bare = await render(`${BASE_QUERY} RENDER bar_chart`);
    const explicitGames = await render(
      `${BASE_QUERY} RENDER bar_chart WITH (y = games)`,
    );
    // metrics[0] is `games`, so a bare clause must render byte-identically to
    // an explicit `y = games` — proving the pre-DSL default is preserved.
    expect(
      bare.image?.data.equals(explicitGames.image?.data ?? Buffer.alloc(0)),
    ).toBe(true);
  });
});

describe("RENDER clause — full runner pipeline", () => {
  test("runReport renders a chart report and records a SUCCESS run", async () => {
    await seedFacts();
    const report = await prisma.report.create({
      data: {
        serverId,
        ownerId: testAccountId("717171001"),
        channelId: testChannelId("717171002"),
        title: "Solo Win Rate",
        description: null,
        queryText: `${BASE_QUERY} RENDER bar_chart WITH (y = win_rate)`,
        lookbackDays: 30,
        maxRows: 10,
        isEnabled: true,
        isSystemManaged: false,
        cronExpression: "0 0 * * *",
        nextScheduledRunAt: now,
        createdTime: now,
        updatedTime: now,
      },
    });

    const result = await runReport({ prisma, report, trigger: "MANUAL", now });
    expect(result.rowsReturned).toBe(2);
    expect(result.output.image).not.toBeNull();
    expect(result.output.content).toBe("**Solo Win Rate**");

    const run = await prisma.reportRun.findFirstOrThrow({
      where: { reportId: report.id },
    });
    expect(run.status).toBe("SUCCESS");
    expect(run.rowsReturned).toBe(2);
  });

  test("a malformed RENDER clause records a FAILED run (no silent bypass)", async () => {
    await seedFacts();
    const report = await prisma.report.create({
      data: {
        serverId,
        ownerId: testAccountId("717171003"),
        channelId: testChannelId("717171004"),
        title: "Broken Render",
        description: null,
        // `not_a_metric` is not a SELECTed column → parseReportQuery throws.
        queryText: `${BASE_QUERY} RENDER bar_chart WITH (y = not_a_metric)`,
        lookbackDays: 30,
        maxRows: 10,
        isEnabled: true,
        isSystemManaged: false,
        cronExpression: "0 0 * * *",
        nextScheduledRunAt: now,
        createdTime: now,
        updatedTime: now,
      },
    });

    await expect(
      runReport({ prisma, report, trigger: "MANUAL", now }),
    ).rejects.toThrow();

    // The failure must be recorded, not bypassed: the run row exists, is marked
    // FAILED, and carries the parse error.
    const run = await prisma.reportRun.findFirstOrThrow({
      where: { reportId: report.id },
    });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).not.toBeNull();
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.reportRun.deleteMany());
  await deleteIfExists(() => prisma.report.deleteMany());
  await deleteIfExists(() => prisma.matchParticipantFact.deleteMany());
}

type FactInput = {
  player: number;
  alias: string;
  matchId: string;
  win: boolean;
};

async function createFact(input: FactInput): Promise<void> {
  const puuid: LeaguePuuid = testPuuid(`render-${input.alias}`);
  await prisma.matchParticipantFact.create({
    data: {
      serverId,
      matchId: input.matchId,
      gameId: input.matchId,
      gameCreationAt: now,
      gameEndAt: now,
      queueId: 420,
      queue: "solo",
      durationSeconds: 1800,
      playerId: PlayerIdSchema.parse(input.player),
      accountId: AccountIdSchema.parse(input.player),
      playerAlias: input.alias,
      discordId: null,
      puuid,
      region: "AMERICA_NORTH",
      participantId: input.player,
      teamId: 100,
      championId: 22,
      championName: "Ashe",
      win: input.win,
      surrendered: false,
      earlySurrendered: false,
      kills: 5,
      deaths: 3,
      assists: 7,
      kda: 4,
      creepScore: 150,
      goldEarned: 10_000,
      totalDamageDealt: 50_000,
      damageToChampions: 12_000,
      damageTaken: 20_000,
      visionScore: 20,
      rawParticipantJson: "{}",
    },
  });
}
