/**
 * The fixed data behind the docs' render samples.
 *
 * Each sample is a real ScoutQL v2 query plus the rows the engine would have
 * returned for it. The queries are compiled by `compileScoutQl`, so a sample
 * whose syntax the language no longer accepts fails `bun run generate` rather
 * than shipping an example nobody can run.
 *
 * Time-bucketed samples derive their labels from the compiled plan's own
 * window (`bucketLabels`) instead of hard-coding dates: the snapshot builder
 * fills every bucket a bounded window covers, so a hand-written list that
 * disagreed with the window would silently draw a chart with holes in it.
 */
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import type { ReportResultRow } from "@scout-for-lol/backend/reports/query-types.ts";
import type { LakeScalar } from "@scout-for-lol/backend/reports/duckdb/row-schema.ts";
import type { TemporalRange } from "@scout-for-lol/backend/reports/temporal-range.ts";
import { visualizationBucketLabels } from "@scout-for-lol/backend/reports/visualization-buckets.ts";

export type SampleContext = { plan: ScoutQlPlan; range: TemporalRange };

export type RenderSample = {
  /** The `RENDER` token this sample demonstrates. */
  kind: string;
  title: string;
  query: string;
  rows: (context: SampleContext) => ReportResultRow[];
};

function row(input: {
  dimensions: string[];
  keys: LakeScalar[];
  /** Rows behind the aggregates, which charts print as `n=`. */
  sampleSize: number;
  values: Record<string, number | string | null>;
}): ReportResultRow {
  return {
    label: input.dimensions.join(" • "),
    dimensions: input.dimensions,
    keys: input.keys,
    mentionIdentity: null,
    values: Object.entries(input.values).map(([column, value]) => ({
      column,
      value,
      sampleSize: input.sampleSize,
    })),
  };
}

/** One row per named dimension value, keyed by that same string. */
function dimensionRow(
  name: string,
  sampleSize: number,
  values: Record<string, number | string | null>,
): ReportResultRow {
  return row({ dimensions: [name], keys: [name], sampleSize, values });
}

/** The bucket labels the plan's window covers, in chart order. */
function bucketLabels(
  context: SampleContext,
  bucket: "day" | "week",
): string[] {
  return visualizationBucketLabels(
    { range: context.range, timezone: "UTC" },
    bucket,
  );
}

const PLAYERS = [
  { name: "Faker", games: 146, winRate: 0.575, kda: 4.12 },
  { name: "Caps", games: 111, winRate: 0.514, kda: 3.48 },
  { name: "Chovy", games: 90, winRate: 0.544, kda: 3.91 },
  { name: "Ruler", games: 89, winRate: 0.517, kda: 3.36 },
  { name: "Keria", games: 76, winRate: 0.461, kda: 2.87 },
  { name: "Zeus", games: 71, winRate: 0.535, kda: 3.02 },
] as const;

type Player = (typeof PLAYERS)[number];

const damageOf = (player: Player): number =>
  Math.round(player.games * 21_500 + player.kda * 900);
const csPerMinuteOf = (player: Player): number =>
  Math.round((6.4 + player.kda / 4) * 100) / 100;
const visionOf = (player: Player): number =>
  Math.round((24 + player.games / 6) * 10) / 10;

const QUEUES = [
  ["solo", 412],
  ["aram", 268],
  ["flex", 191],
  ["arena", 96],
  ["quickplay", 64],
] as const;

const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
const CHAMPIONS = [
  "Ziggs",
  "TwistedFate",
  "Corki",
  "Kaisa",
  "Warwick",
] as const;

/** Weekly volume and win rate, cycled across however many buckets there are. */
const WEEKLY = [
  { games: 142, winRate: 0.521 },
  { games: 168, winRate: 0.548 },
  { games: 151, winRate: 0.483 },
  { games: 187, winRate: 0.567 },
  { games: 173, winRate: 0.532 },
  { games: 159, winRate: 0.509 },
] as const;

function weeklyAt(index: number): { games: number; winRate: number } {
  const entry = WEEKLY[index % WEEKLY.length];
  if (entry === undefined) {
    throw new Error("WEEKLY must not be empty.");
  }
  return entry;
}

/** Standings movement per player, one position per week bucket. */
const BUMP_STANDINGS: Record<string, number[]> = {
  Faker: [1, 1, 2, 1, 2],
  Caps: [2, 3, 1, 2, 1],
  Chovy: [3, 2, 3, 4, 4],
  Ruler: [4, 4, 4, 3, 3],
};

/** Game-duration histogram: five-minute buckets, in seconds. */
const DURATION_BUCKETS = [
  [900, 41],
  [1200, 118],
  [1500, 264],
  [1800, 331],
  [2100, 197],
  [2400, 74],
  [2700, 26],
] as const;

/** Kills per game, as the five-number summary a box plot draws. */
const KILL_SUMMARIES = [
  ["Kaisa", [0, 4, 7, 11, 24]],
  ["Ziggs", [0, 3, 6, 9, 19]],
  ["TwistedFate", [0, 2, 5, 8, 17]],
  ["Corki", [0, 3, 5, 9, 21]],
  ["Warwick", [0, 2, 4, 7, 15]],
  ["Leona", [0, 0, 2, 4, 11]],
] as const;

const RELATIVE_30 =
  "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

function playerRows(
  values: (player: Player) => Record<string, number | string | null>,
  count: number = PLAYERS.length,
): ReportResultRow[] {
  return PLAYERS.slice(0, count).map((player) =>
    dimensionRow(player.name, player.games, values(player)),
  );
}

function weekRows(
  context: SampleContext,
  values: (weekly: {
    games: number;
    winRate: number;
  }) => Record<string, number | string | null>,
): ReportResultRow[] {
  return bucketLabels(context, "week").map((week, index) => {
    const weekly = weeklyAt(index);
    return row({
      dimensions: [week],
      keys: [`${week}T00:00:00.000Z`],
      sampleSize: weekly.games,
      values: { week, ...values(weekly) },
    });
  });
}

export const RENDER_SAMPLES: readonly RenderSample[] = [
  {
    kind: "table",
    title: "Most games played",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate, kda() AS kda
FROM match_participants
${RELATIVE_30}
GROUP BY player
ORDER BY games DESC
LIMIT 6
RENDER table`,
    rows: () =>
      playerRows((player) => ({
        games: player.games,
        win_rate: player.winRate,
        kda: player.kda,
      })),
  },
  {
    kind: "list",
    title: "Most games played",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
${RELATIVE_30}
GROUP BY player
ORDER BY games DESC
LIMIT 6
RENDER list`,
    rows: () =>
      playerRows((player) => ({
        games: player.games,
        win_rate: player.winRate,
      })),
  },
  {
    kind: "leaderboard",
    title: "Most games played",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate
FROM match_participants
${RELATIVE_30}
GROUP BY player
ORDER BY games DESC
LIMIT 6
RENDER leaderboard WITH (mentions = 0)`,
    rows: () =>
      playerRows((player) => ({
        games: player.games,
        win_rate: player.winRate,
      })),
  },
  {
    kind: "bar_chart",
    title: "Most games played",
    query: `SELECT COUNT(*) AS games
FROM match_participants
${RELATIVE_30}
GROUP BY player
ORDER BY games DESC
LIMIT 6
RENDER bar_chart WITH (y = games)`,
    rows: () => playerRows((player) => ({ games: player.games })),
  },
  {
    kind: "line_chart",
    title: "Weekly game volume",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
${RELATIVE_30}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER line_chart WITH (y = games, x_axis = 'Week', smooth = true)`,
    rows: (context) => weekRows(context, (weekly) => ({ games: weekly.games })),
  },
  {
    kind: "area_chart",
    title: "Weekly game volume",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
${RELATIVE_30}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER area_chart WITH (y = games, x_axis = 'Week', smooth = true)`,
    rows: (context) => weekRows(context, (weekly) => ({ games: weekly.games })),
  },
  {
    kind: "stacked_bar",
    title: "Weekly wins and losses",
    query: `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) FILTER (WHERE win) AS wins, COUNT(*) FILTER (WHERE NOT win) AS losses
FROM match_participants
${RELATIVE_30}
GROUP BY DATE_TRUNC('week', game_creation_at)
ORDER BY week ASC
RENDER stacked_bar WITH (y = (wins, losses))`,
    rows: (context) =>
      weekRows(context, (weekly) => {
        const wins = Math.round(weekly.games * weekly.winRate);
        return { wins, losses: weekly.games - wins };
      }),
  },
  {
    kind: "donut_chart",
    title: "Queue mix",
    query: `SELECT COUNT(*) AS games
FROM match_participants
${RELATIVE_30}
GROUP BY queue
ORDER BY games DESC
RENDER donut_chart WITH (y = games)`,
    rows: () =>
      QUEUES.map(([queue, games]) => dimensionRow(queue, games, { games })),
  },
  {
    kind: "scatter_chart",
    title: "Damage against KDA",
    query: `SELECT SUM(total_damage_dealt_to_champions) AS damage, kda() AS kda, COUNT(*) AS games
FROM match_participants
${RELATIVE_30}
GROUP BY player
RENDER scatter_chart WITH (x = damage, y = kda, size = games)`,
    rows: () =>
      playerRows((player) => ({
        damage: damageOf(player),
        kda: player.kda,
        games: player.games,
      })),
  },
  {
    kind: "heatmap",
    title: "Champion win rate by position",
    query: `SELECT AVG(win::INT) AS win_rate
FROM match_participants
${RELATIVE_30}
GROUP BY champion, team_position
RENDER heatmap WITH (value = win_rate, series = team_position, palette = gold)`,
    rows: () =>
      CHAMPIONS.flatMap((champion, championIndex) =>
        POSITIONS.map((position, positionIndex) =>
          row({
            dimensions: [champion, position],
            keys: [champion, position],
            sampleSize: 18 + ((championIndex * 5 + positionIndex * 3) % 27),
            values: {
              win_rate:
                0.38 + ((championIndex * 7 + positionIndex * 11) % 23) / 100,
            },
          }),
        ),
      ),
  },
  {
    kind: "radar_chart",
    title: "Combat profile",
    query: `SELECT AVG(win::INT) AS win_rate, kda() AS kda, per_minute(creep_score) AS cs_per_minute, AVG(vision_score) AS vision_score, AVG(total_damage_dealt_to_champions) AS damage
FROM match_participants
${RELATIVE_30}
GROUP BY player
LIMIT 3
RENDER radar_chart WITH (y = (win_rate, kda, cs_per_minute, vision_score, damage))`,
    rows: () =>
      playerRows(
        (player) => ({
          win_rate: player.winRate,
          kda: player.kda,
          cs_per_minute: csPerMinuteOf(player),
          vision_score: visionOf(player),
          damage: Math.round(damageOf(player) / player.games),
        }),
        3,
      ),
  },
  {
    kind: "kpi_card",
    title: "Server snapshot",
    query: `SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate, kda() AS kda, AVG(game_duration_seconds) AS avg_length
FROM match_participants
${RELATIVE_30}
RENDER kpi_card WITH (y = (games, win_rate, kda, avg_length))`,
    rows: () => [
      row({
        // A grand total has no dimension; the engine labels the single row
        // "All" and carries no grouping keys.
        dimensions: ["All"],
        keys: [],
        sampleSize: 1031,
        values: {
          games: 1031,
          win_rate: 0.533,
          kda: 2.38,
          avg_length: 1709,
        },
      }),
    ],
  },
  {
    kind: "bump_chart",
    title: "Weekly standings",
    query: `SELECT COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 28 DAY
GROUP BY player, DATE_TRUNC('week', game_creation_at)
ORDER BY games DESC
RENDER bump_chart WITH (y = games)`,
    rows: (context) => {
      const weeks = bucketLabels(context, "week");
      return Object.entries(BUMP_STANDINGS).flatMap(([player, standings]) =>
        weeks.map((week, index) =>
          row({
            dimensions: [player, week],
            keys: [player, `${week}T00:00:00.000Z`],
            sampleSize: 40 - (standings[index] ?? 1) * 6,
            // Fewer games is a worse standing, so invert the position into a
            // plausible volume — the chart ranks the rows itself.
            values: { games: 40 - (standings[index] ?? 1) * 6 },
          }),
        ),
      );
    },
  },
  {
    kind: "calendar_heatmap",
    title: "Daily activity",
    query: `SELECT COUNT(*) AS games
FROM match_participants
WHERE (game_creation_at AT TIME ZONE 'UTC')::DATE BETWEEN '2026-06-29' AND '2026-07-26'
GROUP BY DATE_TRUNC('day', game_creation_at)
ORDER BY games DESC
RENDER calendar_heatmap WITH (y = games, palette = gold)`,
    rows: (context) =>
      bucketLabels(context, "day").map((day, index) =>
        row({
          dimensions: [day],
          keys: [`${day}T00:00:00.000Z`],
          sampleSize: 3 + ((index * 5) % 11),
          values: { games: 3 + ((index * 5) % 11) },
        }),
      ),
  },
  {
    kind: "histogram",
    title: "Game length distribution",
    query: `SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games
FROM match_participants
${RELATIVE_30}
GROUP BY FLOOR(game_duration_seconds / 300) * 300
ORDER BY bucket ASC
RENDER histogram WITH (x = bucket, y = games)`,
    rows: () =>
      DURATION_BUCKETS.map(([start, games]) =>
        row({
          dimensions: [String(start)],
          keys: [start],
          sampleSize: games,
          values: { bucket: start, games },
        }),
      ),
  },
  {
    kind: "box_plot",
    title: "Kills per game by champion",
    query: `SELECT MIN(kills) AS low, QUANTILE_CONT(kills, 0.25) AS q1, MEDIAN(kills) AS med, QUANTILE_CONT(kills, 0.75) AS q3, MAX(kills) AS high
FROM match_participants
${RELATIVE_30}
GROUP BY champion
ORDER BY med DESC
LIMIT 6
RENDER box_plot WITH (y = (low, q1, med, q3, high))`,
    rows: () =>
      KILL_SUMMARIES.map(([champion, summary]) =>
        dimensionRow(champion, summary[4] * 9, {
          low: summary[0],
          q1: summary[1],
          med: summary[2],
          q3: summary[3],
          high: summary[4],
        }),
      ),
  },
];
