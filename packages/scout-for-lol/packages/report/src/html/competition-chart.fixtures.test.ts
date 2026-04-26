import { afterAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { rankToLeaguePoints } from "@scout-for-lol/data";
import type { Rank } from "@scout-for-lol/data";
import {
  competitionChartToImage,
  type CompetitionChartProps,
} from "#src/html/competition-chart.ts";

const OUTPUT_DIR = path.resolve(
  import.meta.dir,
  "..",
  "..",
  "test-output",
  "competition-chart",
);

const writtenFiles: string[] = [];

await mkdir(OUTPUT_DIR, { recursive: true });

afterAll(() => {
  console.log("");
  console.log("=== RENDERED FIXTURES ===");
  for (const file of writtenFiles) {
    console.log(file);
  }
});

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = Math.trunc(state + 0x6d_2b_79_f5);
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DAY_MS = 86_400_000;

function daysFrom(start: Date, days: number): Date[] {
  return Array.from(
    { length: days },
    (_, i) => new Date(start.getTime() + i * DAY_MS),
  );
}

async function renderFixture(
  filename: string,
  props: CompetitionChartProps,
): Promise<void> {
  const buffer = await competitionChartToImage(props);
  const outPath = path.join(OUTPUT_DIR, filename);
  await Bun.write(outPath, buffer);
  writtenFiles.push(outPath);
  expect(buffer.length).toBeGreaterThan(4096);
}

const NAMES = [
  "Dan",
  "Zhi",
  "Dan Kim",
  "Brandon",
  "Edward",
  "Kendrick",
  "Long",
  "Joel",
  "Virmel",
  "Lisa",
];

const SEASON_START = new Date("2026-04-01T00:00:00Z");

// ============================================================================
// BAR fixtures — cumulative count metrics (current standings, no time axis)
// ============================================================================

test("01-bar-most-games-10p — current standings", async () => {
  const rng = mulberry32(1);
  const bars = NAMES.map((playerName) => ({
    playerName,
    value: 60 + Math.floor(rng() * 90),
  }));
  await renderFixture("01-bar-most-games-10p.png", {
    chartType: "bar",
    title: "Most Legal Legends",
    subtitle: "Most games played in All Queues",
    yAxisLabel: "Games",
    bars,
  });
});

test("04-bar-most-wins-10p — current standings", async () => {
  const rng = mulberry32(4);
  const bars = NAMES.map((playerName) => ({
    playerName,
    value: 30 + Math.floor(rng() * 60),
  }));
  await renderFixture("04-bar-most-wins-10p.png", {
    chartType: "bar",
    title: "Most Wins — Season 14",
    subtitle: "Most wins in Solo Queue",
    yAxisLabel: "Wins",
    bars,
  });
});

test("09-bar-tied-scores — overlapping leaders", async () => {
  // Top 4 tied; remaining 6 spread below
  const rng = mulberry32(9);
  const bars = NAMES.map((playerName, idx) => ({
    playerName,
    value: idx < 4 ? 150 : 60 + Math.floor(rng() * 80),
  }));
  await renderFixture("09-bar-tied-scores.png", {
    chartType: "bar",
    title: "Tied at the Top",
    subtitle: "Most games played in All Queues — overlapping leaders",
    yAxisLabel: "Games",
    bars,
  });
});

test("10-bar-long-names — legend layout under realistic Discord names", async () => {
  const rng = mulberry32(10);
  const longNames = [
    "TheMostExquisite",
    "VirmelTheGreat99",
    "DragonOfTheNorth",
    "xX_KendrickL_Xx",
    "SilverBulletLong",
    "BrandonTheBrave",
    "DanKimDestroyer",
    "EmeraldEdward42",
    "LisaInTheSky",
    "ZhiZhiZhiZhiZhi",
  ];
  const bars = longNames.map((playerName) => ({
    playerName,
    value: 50 + Math.floor(rng() * 100),
  }));
  await renderFixture("10-bar-long-names.png", {
    chartType: "bar",
    title: "Most Legal Legends",
    subtitle: "Most games played in All Queues — long display names",
    yAxisLabel: "Games",
    bars,
  });
});

test("11-bar-single-participant — degenerate case", async () => {
  await renderFixture("11-bar-single-participant.png", {
    chartType: "bar",
    title: "Solo Bracket",
    subtitle: "Most games played in Solo Queue — single participant",
    yAxisLabel: "Games",
    bars: [{ playerName: "Jerred", value: 91 }],
  });
});

// ============================================================================
// LINE fixtures — over-time metrics (rank ladder, LP delta, win rate)
// ============================================================================

test("02-line-highest-rank-30d-10p — rank ladder mixed climb/fall", async () => {
  const days = daysFrom(SEASON_START, 30);
  const rng = mulberry32(2);
  const startRanks: Rank[] = [
    { tier: "diamond", division: 4, lp: 30, wins: 0, losses: 0 },
    { tier: "emerald", division: 1, lp: 70, wins: 0, losses: 0 },
    { tier: "emerald", division: 2, lp: 80, wins: 0, losses: 0 },
    { tier: "emerald", division: 4, lp: 0, wins: 0, losses: 0 },
    { tier: "platinum", division: 1, lp: 90, wins: 0, losses: 0 },
    { tier: "platinum", division: 2, lp: 60, wins: 0, losses: 0 },
    { tier: "platinum", division: 3, lp: 40, wins: 0, losses: 0 },
    { tier: "platinum", division: 4, lp: 20, wins: 0, losses: 0 },
    { tier: "gold", division: 1, lp: 50, wins: 0, losses: 0 },
    { tier: "gold", division: 2, lp: 0, wins: 0, losses: 0 },
  ];
  const series = NAMES.map((playerName, i) => {
    let lp: number = rankToLeaguePoints(startRanks[i]);
    const points = days.map((date) => {
      const delta = Math.round((rng() - 0.45) * 40);
      lp = Math.max(0, lp + delta);
      return { date, value: lp };
    });
    return { playerName, points };
  });
  await renderFixture("02-line-highest-rank-30d-10p.png", {
    chartType: "line",
    title: "Highest Solo Q",
    subtitle: "Highest rank in Solo Queue",
    yAxisLabel: "Ladder points",
    startDate: days[0]!,
    endDate: days.at(-1)!,
    series,
  });
});

test("03-line-rank-climb-14d-10p — deltas, includes negatives", async () => {
  const days = daysFrom(SEASON_START, 14);
  const rng = mulberry32(3);
  const series = NAMES.map((playerName) => {
    let total = 0;
    const points = days.map((date) => {
      total += Math.round((rng() - 0.4) * 50);
      return { date, value: total };
    });
    return { playerName, points };
  });
  await renderFixture("03-line-rank-climb-14d-10p.png", {
    chartType: "line",
    title: "Solo Q Climb",
    subtitle: "Most rank climb in Solo Queue",
    yAxisLabel: "LP gained",
    startDate: days[0]!,
    endDate: days.at(-1)!,
    series,
  });
});

test("05-line-win-rate-30d-10p — 0–100 percentages", async () => {
  const days = daysFrom(SEASON_START, 30);
  const rng = mulberry32(5);
  const series = NAMES.map((playerName) => {
    let rate = 40 + rng() * 30;
    const points = days.map((date) => {
      rate += (rng() - 0.5) * 4;
      rate = Math.max(0, Math.min(100, rate));
      return { date, value: Number(rate.toFixed(1)) };
    });
    return { playerName, points };
  });
  await renderFixture("05-line-win-rate-30d-10p.png", {
    chartType: "line",
    title: "Highest Win Rate",
    subtitle: "Highest win rate in Solo Queue (min 10 games)",
    yAxisLabel: "Win rate (%)",
    startDate: days[0]!,
    endDate: days.at(-1)!,
    series,
  });
});

test("06-line-sparse-late-joiner — null gaps, partial data", async () => {
  const days = daysFrom(SEASON_START, 30);
  const rng = mulberry32(6);
  const series = NAMES.map((playerName, idx) => {
    const lateJoiner = idx >= 7;
    let lp = 1500 + Math.floor(rng() * 500);
    const points = days.map((date, dayIdx) => {
      if (lateJoiner && dayIdx < 23) {
        return { date, value: null };
      }
      lp += Math.round((rng() - 0.4) * 40);
      return { date, value: lp };
    });
    return { playerName, points };
  });
  await renderFixture("06-line-sparse-late-joiner.png", {
    chartType: "line",
    title: "Highest Solo Q",
    subtitle: "Highest rank in Solo Queue — with late joiners",
    yAxisLabel: "Ladder points",
    startDate: days[0]!,
    endDate: days.at(-1)!,
    series,
  });
});

test("07-line-short-range-3-snapshots — minimum viable graph", async () => {
  const days = daysFrom(SEASON_START, 3);
  const rng = mulberry32(7);
  const shortNames = NAMES.slice(0, 5);
  const series = shortNames.map((playerName) => {
    let total = 0;
    const points = days.map((date) => {
      total += Math.round((rng() - 0.4) * 40);
      return { date, value: total };
    });
    return { playerName, points };
  });
  await renderFixture("07-line-short-range-3-snapshots.png", {
    chartType: "line",
    title: "Solo Q Climb",
    subtitle: "Most rank climb in Solo Queue — day 3",
    yAxisLabel: "LP gained",
    startDate: days[0]!,
    endDate: days.at(-1)!,
    series,
  });
});

test("08-line-single-participant — degenerate case", async () => {
  const days = daysFrom(SEASON_START, 30);
  const rng = mulberry32(8);
  let total = 0;
  const series = [
    {
      playerName: "Jerred",
      points: days.map((date) => {
        total += Math.round((rng() - 0.3) * 30);
        return { date, value: total };
      }),
    },
  ];
  await renderFixture("08-line-single-participant.png", {
    chartType: "line",
    title: "Solo Q Climb",
    subtitle: "Most rank climb in Solo Queue — single participant",
    yAxisLabel: "LP gained",
    startDate: days[0]!,
    endDate: days.at(-1)!,
    series,
  });
});
