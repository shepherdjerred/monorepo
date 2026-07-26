import {
  afterAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
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
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  resetTestLake,
  writeTestLake,
  type TestLakeMatchFact,
} from "#src/testing/test-report-lake.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import {
  renderReportOutput,
  type RenderedReportOutput,
} from "#src/reports/output.ts";
import { runReport } from "#src/reports/runner.ts";
import { loadPlayerDiscordIds } from "#src/reports/alias-mentions.ts";

// End-to-end coverage of the report DSL's declarative `RENDER` clause: real
// report-lake rows → parse → compiled SQL on DuckDB → render. This is the
// only suite that actually exercises chart rendering (echarts → SVG → PNG).
//
// Chart rendering (echarts → SVG → resvg PNG) is heavy and, on a cold Dagger
// CI engine, a single render can exceed Bun's 5s default per-test timeout.
// Give the whole suite generous headroom so a slow-but-successful render is
// never flagged as a failure.
setDefaultTimeout(30_000);
const { prisma } = createTestDatabase("report-render-test");
const serverId = testGuildId("717171");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const TITLE = "Test Report";
const lakeDir = resolveLakeDir();

// Alpha: 3 solo games, 2 wins (games=3, win_rate≈0.67).
// Bravo: 1 solo game, 1 win  (games=1, win_rate=1.0).
// games and win_rate rank players in opposite orders, so the chosen Y channel
// (and ORDER BY) are observable.
function fact(input: {
  player: number;
  alias: string;
  matchId: string;
  win: boolean;
  discordId?: string | null;
  championName?: string;
}): TestLakeMatchFact {
  return {
    playerId: input.player,
    playerAlias: input.alias,
    ...(input.discordId === undefined ? {} : { discordId: input.discordId }),
    matchId: input.matchId,
    puuid: testPuuid(`render-${input.alias}`),
    queue: "solo",
    win: input.win,
    surrendered: false,
    kills: 5,
    deaths: 3,
    assists: 7,
    ...(input.championName === undefined
      ? {}
      : { championName: input.championName }),
    gameCreationAt: now,
  };
}

async function seedFacts(): Promise<void> {
  await writeTestLake(lakeDir, {
    serverId,
    matchFacts: [
      fact({ player: 1, alias: "Alpha", matchId: "NA1_a1", win: true }),
      fact({ player: 1, alias: "Alpha", matchId: "NA1_a2", win: true }),
      fact({ player: 1, alias: "Alpha", matchId: "NA1_a3", win: false }),
      fact({ player: 2, alias: "Bravo", matchId: "NA1_b1", win: true }),
    ],
  });
}

const BASE_QUERY =
  "SELECT player, games, wins, win_rate FROM match_participants WHERE queue IN ('solo') GROUP BY player ORDER BY games DESC";

async function render(queryText: string): Promise<RenderedReportOutput> {
  const result = await executeReportQuery({
    prisma,
    serverId,
    queryText,
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
    expect(output.content).toContain("Player | Games | Wins | Win rate");
    expect(output.content).toContain("Alpha | 3 | 2 | 66.7%");
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
    expect(output.content).toContain("Player | Games | Wins | Win rate");
  });
});

describe("RENDER clause — leaderboard top-3 mentions", () => {
  test("mentions ranks 1-3 and leaves rank 4+ as plain alias", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_m1",
          win: true,
          discordId: testAccountId("1001"),
        }),
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_m2",
          win: true,
          discordId: testAccountId("1001"),
        }),
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_m3",
          win: true,
          discordId: testAccountId("1001"),
        }),
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_m4",
          win: true,
          discordId: testAccountId("1001"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_m5",
          win: true,
          discordId: testAccountId("1002"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_m6",
          win: true,
          discordId: testAccountId("1002"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_m7",
          win: true,
          discordId: testAccountId("1002"),
        }),
        fact({
          player: 3,
          alias: "Charlie",
          matchId: "NA1_m8",
          win: true,
          discordId: testAccountId("1003"),
        }),
        fact({
          player: 3,
          alias: "Charlie",
          matchId: "NA1_m9",
          win: true,
          discordId: testAccountId("1003"),
        }),
        fact({
          player: 4,
          alias: "Delta",
          matchId: "NA1_m10",
          win: true,
          discordId: testAccountId("1004"),
        }),
      ],
    });
    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText: `${BASE_QUERY} RENDER leaderboard`,
      now,
    });
    const output = await renderReportOutput({
      title: TITLE,
      result,
      startedAt: now,
    });
    // ORDER BY games DESC: Alpha(4), Bravo(3), Charlie(2) rank 1-3 → mentioned.
    expect(output.content).toContain(`1. <@${testAccountId("1001")}>`);
    expect(output.content).toContain(`2. <@${testAccountId("1002")}>`);
    expect(output.content).toContain(`3. <@${testAccountId("1003")}>`);
    // Delta ranks 4th — left as a plain alias even though it has a Discord ID.
    expect(output.content).toContain("4. Delta");
    expect(output.content).not.toContain(`<@${testAccountId("1004")}>`);
  });
});

describe("RENDER clause — leaderboard mentions option", () => {
  test("RENDER leaderboard WITH (mentions = 1) only mentions rank 1", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_n1",
          win: true,
          discordId: testAccountId("6001"),
        }),
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_n2",
          win: true,
          discordId: testAccountId("6001"),
        }),
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_n3",
          win: true,
          discordId: testAccountId("6001"),
        }),
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_n4",
          win: true,
          discordId: testAccountId("6001"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_n5",
          win: true,
          discordId: testAccountId("6002"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_n6",
          win: true,
          discordId: testAccountId("6002"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_n7",
          win: true,
          discordId: testAccountId("6002"),
        }),
      ],
    });
    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText: `${BASE_QUERY} RENDER leaderboard WITH (mentions = 1)`,
      now,
    });
    const output = await renderReportOutput({
      title: TITLE,
      result,
      startedAt: now,
    });
    expect(output.content).toContain(`1. <@${testAccountId("6001")}>`);
    // mentions = 1 overrides the default top-3 — rank 2 stays a plain alias
    // even though it has a linked Discord ID.
    expect(output.content).toContain("2. Bravo");
    expect(output.content).not.toContain(`<@${testAccountId("6002")}>`);
  });

  test("RENDER leaderboard WITH (mentions = all) mentions every row", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_o1",
          win: true,
          discordId: testAccountId("7001"),
        }),
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_o2",
          win: true,
          discordId: testAccountId("7001"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_o3",
          win: true,
          discordId: testAccountId("7002"),
        }),
      ],
    });
    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText: `${BASE_QUERY} RENDER leaderboard WITH (mentions = all)`,
      now,
    });
    const output = await renderReportOutput({
      title: TITLE,
      result,
      startedAt: now,
    });
    expect(output.content).toContain(`1. <@${testAccountId("7001")}>`);
    expect(output.content).toContain(`2. <@${testAccountId("7002")}>`);
  });

  test("RENDER leaderboard WITH (mentions = 0) disables mentions entirely", async () => {
    await seedFacts();
    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText: `${BASE_QUERY} RENDER leaderboard WITH (mentions = 0)`,
      now,
    });
    const output = await renderReportOutput({
      title: TITLE,
      result,
      startedAt: now,
    });
    expect(output.content).toContain("1. Alpha");
    expect(output.content).not.toContain(`<@${testAccountId("8001")}>`);
  });
});

describe("RENDER clause — leaderboard mention fallbacks", () => {
  test("does not mention a non-player row that shares a player alias", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({
          player: 1,
          alias: "Lux",
          championName: "Lux",
          matchId: "NA1_lux",
          win: true,
          discordId: testAccountId("1999"),
        }),
      ],
    });
    const output = await render(
      "SELECT champion, games FROM match_participants GROUP BY champion RENDER leaderboard",
    );
    expect(output.content).toContain("1. Lux");
    expect(output.content).not.toContain(`<@${testAccountId("1999")}>`);
  });

  test("a player with no linked Discord ID falls back to their alias", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({
          player: 1,
          alias: "Alpha",
          matchId: "NA1_f1",
          win: true,
          discordId: testAccountId("2001"),
        }),
        fact({
          player: 2,
          alias: "Bravo",
          matchId: "NA1_f2",
          win: true,
        }),
      ],
    });
    const output = await renderReportOutput({
      title: TITLE,
      result: await executeReportQuery({
        prisma,
        serverId,
        queryText: `${BASE_QUERY} RENDER leaderboard`,
        now,
      }),
      startedAt: now,
    });
    expect(output.content).toContain(`1. <@${testAccountId("2001")}>`);
    // Bravo has no entry in the map — falls back to plain alias, not mentioned.
    expect(output.content).toContain("2. Bravo");
  });

  test("group labels mention each linked member independently", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({ player: 1, alias: "Alpha", matchId: "NA1_g1", win: true }),
        fact({ player: 2, alias: "Bravo", matchId: "NA1_g1", win: true }),
      ],
    });
    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT group, games, wins FROM player_groups WHERE queue IN ('solo') GROUP BY group(all) ORDER BY label ASC RENDER leaderboard",
      now,
    });
    const output = await renderReportOutput({
      title: TITLE,
      result,
      startedAt: now,
      playerDiscordIds: new Map([[1, testAccountId("3001")]]),
    });
    expect(output.content).toContain(`1. <@${testAccountId("3001")}> + Bravo`);
  });

  test("runReport builds the mention map from the report's own server's linked players", async () => {
    await seedFacts();
    await prisma.player.create({
      data: {
        discordId: testAccountId("4001"),
        alias: "Alpha",
        serverId,
        creatorDiscordId: testAccountId("4001"),
        createdTime: now,
        updatedTime: now,
      },
    });
    const report = await prisma.report.create({
      data: {
        serverId,
        ownerId: testAccountId("4002"),
        channelId: testChannelId("4003"),
        title: "Mentioned Leaderboard",
        description: null,
        queryText: `${BASE_QUERY} RENDER leaderboard`,
        isEnabled: true,
        isSystemManaged: false,
        cronExpression: "0 0 * * *",
        nextScheduledRunAt: now,
        createdTime: now,
        updatedTime: now,
      },
    });

    const result = await runReport({ prisma, report, trigger: "MANUAL", now });
    expect(result.output.content).toContain(`1. <@${testAccountId("4001")}>`);
    // Bravo has no linked Player row for this server — plain alias.
    expect(result.output.content).toContain("2. Bravo");
  });

  test("loadPlayerDiscordIds omits players without a linked Discord ID", async () => {
    await prisma.player.create({
      data: {
        discordId: null,
        alias: "NoDiscordLink",
        serverId,
        creatorDiscordId: testAccountId("5001"),
        createdTime: now,
        updatedTime: now,
      },
    });
    await prisma.player.create({
      data: {
        discordId: testAccountId("5002"),
        alias: "HasDiscordLink",
        serverId,
        creatorDiscordId: testAccountId("5002"),
        createdTime: now,
        updatedTime: now,
      },
    });
    const map = await loadPlayerDiscordIds(prisma, serverId);
    expect([...map.values()]).toEqual([testAccountId("5002")]);
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

  const analyticsCases = [
    {
      kind: "stacked-bar",
      query:
        "SELECT games, wins, losses FROM match_participants GROUP BY player RENDER stacked_bar WITH (y = (wins, losses), palette = team, labels = value)",
    },
    {
      kind: "area",
      query:
        "SELECT games, wins FROM match_participants GROUP BY player RENDER area_chart WITH (y = (games, wins), smooth = true, theme = minimal_dark)",
    },
    {
      kind: "donut",
      query:
        "SELECT games FROM match_participants GROUP BY outcome RENDER donut_chart WITH (y = games, labels = percent)",
    },
    {
      kind: "scatter",
      query:
        "SELECT games, wins, losses FROM match_participants GROUP BY player RENDER scatter_chart WITH (x = games, y = wins, size = losses, palette = colorblind)",
    },
    {
      kind: "heatmap",
      query:
        "SELECT games FROM match_participants GROUP BY player, outcome RENDER heatmap WITH (value = games, palette = gold, labels = value)",
    },
    {
      kind: "radar",
      query:
        "SELECT games, wins, losses FROM match_participants GROUP BY player RENDER radar_chart WITH (y = (games, wins, losses), legend = right)",
    },
    {
      kind: "kpi",
      query:
        "SELECT games, wins, losses FROM match_participants GROUP BY all RENDER kpi_card WITH (y = (games, wins, losses), theme = minimal_light)",
    },
  ];

  for (const chartCase of analyticsCases) {
    test(`RENDER ${chartCase.kind} produces a PNG`, async () => {
      await seedFacts();
      const output = await render(chartCase.query);
      expect(output.image).not.toBeNull();
      expect(output.image?.data.length).toBeGreaterThan(1000);
      expect(output.image?.data.subarray(1, 4).toString()).toBe("PNG");
    });
  }
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
    // 180s: the CI lint+typecheck+test bundle runs phases in parallel in one
    // CPU-limited container, so this satori/resvg render (2.7s on idle cores)
    // can be timeshared into minutes (5.0s in build 5027, >60s in 5028).
    // Supersedes PR #1398's 60s.
  }, 180_000);

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
  await deleteIfExists(() => prisma.player.deleteMany());
  await resetTestLake(lakeDir);
}
