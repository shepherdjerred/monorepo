/**
 * Regenerate one sample per ScoutQL `RENDER` kind, using Scout's real report
 * renderer.
 *
 * The samples are not mock-ups: each one is produced by driving
 * `renderReportOutput` — the exact function that builds what Scout posts to
 * Discord — with a compiled ScoutQL plan and a fixed row set. Chart kinds emit
 * the PNG the bot would attach; text kinds emit the literal message content.
 *
 * Because the kind list is read from `REPORT_RENDER_KINDS`, adding a render
 * kind without adding a sample here fails this script, and the committed
 * output is checked for drift in CI (`bun run generate` + a clean git tree).
 *
 * Run: bun run generate
 */
import path from "node:path";
import { CompetitionCriteriaSchema } from "@scout-for-lol/data";
import { parseAndCompile } from "@scout-for-lol/data/model/report-query-compile.ts";
import { REPORT_RENDER_KINDS } from "@scout-for-lol/data/model/report-query-registry.ts";
import { renderReportOutput } from "@scout-for-lol/backend/reports/output.ts";

const OUT_DIR = path.join(import.meta.dir, "..", "src", "assets", "generated");

type Cell = Record<string, number | string | null>;

/** Build a result row in the shape the query engine produces. */
function row(label: string, values: Cell, dimensions?: string[]) {
  return {
    label,
    dimensions: dimensions ?? [label],
    mentionIdentity: null,
    values: Object.entries(values).map(([column, value]) => ({
      column,
      value,
    })),
  };
}

const PLAYERS = [
  ["Faker", 146, 0.575, 4.12],
  ["Caps", 111, 0.514, 3.48],
  ["Chovy", 90, 0.544, 3.91],
  ["Ruler", 89, 0.517, 3.36],
  ["Keria", 76, 0.461, 2.87],
  ["Zeus", 71, 0.535, 3.02],
] as const;

const playerRows = PLAYERS.map(([name, games, winRate, kda]) =>
  row(name, { games, win_rate: winRate, kda }),
);

const WEEKS = [
  ["2026-06-29", 142, 0.521],
  ["2026-07-06", 168, 0.548],
  ["2026-07-13", 151, 0.483],
  ["2026-07-20", 187, 0.567],
  ["2026-07-27", 173, 0.532],
] as const;

const weekRows = WEEKS.map(([week, games, winRate]) =>
  row(week, { games, win_rate: winRate, wins: Math.round(games * winRate) }),
);

const QUEUES = [
  ["ranked solo", 412],
  ["ARAM", 268],
  ["ranked flex", 191],
  ["Arena", 96],
  ["quickplay", 64],
] as const;

const POSITIONS = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const CHAMPIONS = ["Ziggs", "TwistedFate", "Corki", "Kaisa", "Warwick"];

const BUMP_WEEKS = ["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20"];
/**
 * Bump-chart rows carry the ranked position the engine derives from the metric,
 * not the metric itself — the chart plots standings movement, so 1 is best.
 */
const BUMP_STANDINGS: Record<string, number[]> = {
  Faker: [1, 1, 2, 1],
  Caps: [2, 3, 1, 2],
  Chovy: [3, 2, 3, 4],
  Ruler: [4, 4, 4, 3],
};

const CALENDAR_START = new Date("2026-06-29T00:00:00Z");
const calendarRows = Array.from({ length: 28 }, (_, offset) => {
  const day = new Date(CALENDAR_START.getTime() + offset * 24 * 60 * 60 * 1000);
  const date = day.toISOString().slice(0, 10);
  return row(date, { games: 3 + ((offset * 5) % 11) });
});

/** Every sample: the query is shown verbatim in the docs beside its output. */
const SAMPLES: {
  kind: string;
  title: string;
  query: string;
  rows: ReturnType<typeof row>[];
  columns: string[];
}[] = [
  {
    kind: "table",
    title: "Most games played",
    query:
      "select games, win_rate, kda\nfrom match_participants\ngroup by player\nduring last 30 days\norder by games desc\nlimit 6\nrender table",
    rows: playerRows,
    columns: ["games", "win_rate", "kda"],
  },
  {
    kind: "list",
    title: "Most games played",
    query:
      "select games, win_rate\nfrom match_participants\ngroup by player\nduring last 30 days\norder by games desc\nlimit 6\nrender list",
    rows: playerRows,
    columns: ["games", "win_rate"],
  },
  {
    kind: "leaderboard",
    title: "Most games played",
    query:
      "select games, win_rate\nfrom match_participants\ngroup by player\nduring last 30 days\norder by games desc\nlimit 6\nrender leaderboard with (mentions = 0)",
    rows: playerRows,
    columns: ["games", "win_rate"],
  },
  {
    kind: "bar_chart",
    title: "Most games played",
    query:
      "select games\nfrom match_participants\ngroup by player\nduring last 30 days\norder by games desc\nlimit 6\nrender bar_chart with (y = games)",
    rows: playerRows,
    columns: ["games"],
  },
  {
    kind: "line_chart",
    title: "Weekly game volume",
    query:
      'select games\nfrom match_participants\ngroup by week\nduring last 30 days\norder by week asc\nrender line_chart with (y = games, x_axis = "Week", smooth = true)',
    rows: weekRows,
    columns: ["games"],
  },
  {
    kind: "area_chart",
    title: "Weekly game volume",
    query:
      'select games\nfrom match_participants\ngroup by week\nduring last 30 days\norder by week asc\nrender area_chart with (y = games, x_axis = "Week", smooth = true)',
    rows: weekRows,
    columns: ["games"],
  },
  {
    kind: "stacked_bar",
    title: "Weekly wins and losses",
    query:
      "select wins, losses\nfrom match_participants\ngroup by week\nduring last 30 days\norder by week asc\nrender stacked_bar with (y = (wins, losses))",
    rows: WEEKS.map(([week, games, winRate]) => {
      const wins = Math.round(games * winRate);
      return row(week, { wins, losses: games - wins });
    }),
    columns: ["wins", "losses"],
  },
  {
    kind: "donut_chart",
    title: "Queue mix",
    query:
      "select games\nfrom match_participants\ngroup by queue\nduring last 30 days\norder by games desc\nrender donut_chart with (y = games)",
    rows: QUEUES.map(([queue, games]) => row(queue, { games })),
    columns: ["games"],
  },
  {
    kind: "scatter_chart",
    title: "Damage against KDA",
    query:
      "select damage_to_champions, kda, games\nfrom match_participants\ngroup by player\nduring last 30 days\nrender scatter_chart with (x = damage_to_champions, y = kda, size = games)",
    rows: PLAYERS.map(([name, games, , kda]) =>
      row(name, {
        damage_to_champions: Math.round(games * 720 + kda * 4200),
        kda,
        games,
      }),
    ),
    columns: ["damage_to_champions", "kda", "games"],
  },
  {
    kind: "heatmap",
    title: "Champion win rate by position",
    query:
      "select win_rate\nfrom match_participants\ngroup by champion, team_position\nduring last 30 days\nrender heatmap with (value = win_rate, series = team_position, palette = gold)",
    rows: CHAMPIONS.flatMap((champion, championIndex) =>
      POSITIONS.map((position, positionIndex) =>
        row(
          `${champion} · ${position}`,
          {
            win_rate:
              0.38 + ((championIndex * 7 + positionIndex * 11) % 23) / 100,
          },
          [champion, position],
        ),
      ),
    ),
    columns: ["win_rate"],
  },
  {
    kind: "radar_chart",
    title: "Combat profile",
    query:
      "select win_rate, kda, cs_per_minute, vision_score, damage_to_champions\nfrom match_participants\ngroup by player\nduring last 30 days\nlimit 3\nrender radar_chart with (y = (win_rate, kda, cs_per_minute, vision_score, damage_to_champions))",
    rows: PLAYERS.slice(0, 3).map(([name, games, winRate, kda]) =>
      row(name, {
        win_rate: winRate,
        kda,
        cs_per_minute: 6.4 + kda / 4,
        vision_score: 28 + games / 6,
        damage_to_champions: Math.round(games * 720 + kda * 4200),
      }),
    ),
    columns: [
      "win_rate",
      "kda",
      "cs_per_minute",
      "vision_score",
      "damage_to_champions",
    ],
  },
  {
    kind: "kpi_card",
    title: "Server snapshot",
    query:
      "select games, win_rate, kda, avg_game_duration\nfrom match_participants\ngroup by all\nduring last 30 days\nrender kpi_card with (y = (games, win_rate, kda, avg_game_duration))",
    rows: [
      row("All", {
        games: 1031,
        win_rate: 0.533,
        kda: 2.38,
        avg_game_duration: 28.49,
      }),
    ],
    columns: ["games", "win_rate", "kda", "avg_game_duration"],
  },
  {
    kind: "bump_chart",
    title: "Weekly standings",
    query:
      "select games\nfrom match_participants\ngroup by player\nanalyze last 28 days\nbucket by week\nin time zone 'UTC'\norder by label asc\nrender bump_chart with (y = games)",
    rows: Object.entries(BUMP_STANDINGS).flatMap(([player, positions]) =>
      positions.map((position, index) =>
        row(player, { games: position }, [player, BUMP_WEEKS[index] ?? ""]),
      ),
    ),
    columns: ["games"],
  },
  {
    kind: "calendar_heatmap",
    title: "Daily activity",
    query:
      "select games\nfrom match_participants\ngroup by all\nanalyze between '2026-06-29' and '2026-07-26'\nbucket by day\nin time zone 'UTC'\nrender calendar_heatmap with (y = games, palette = gold)",
    rows: calendarRows,
    columns: ["games"],
  },
];

/**
 * The renderer requires every row value to correspond to a column the plan
 * selected, so project each sample's shared rows down to its own columns.
 */
function project(
  rows: ReturnType<typeof row>[],
  columns: string[],
): ReturnType<typeof row>[] {
  return rows.map((entry) => ({
    ...entry,
    values: entry.values.filter((value) => columns.includes(value.column)),
  }));
}

const declared = new Set(SAMPLES.map((sample) => sample.kind));
const missing = REPORT_RENDER_KINDS.filter(
  (kind) => !declared.has(kind.id),
).map((kind) => kind.id);
if (missing.length > 0) {
  throw new Error(
    `No docs sample defined for render kind(s): ${missing.join(", ")}. ` +
      `Add an entry to SAMPLES in ${import.meta.file}.`,
  );
}
const unknown = [...declared].filter(
  (id) => !REPORT_RENDER_KINDS.some((kind) => kind.id === id),
);
if (unknown.length > 0) {
  throw new Error(
    `Sample declared for unknown render kind(s): ${unknown.join(", ")}`,
  );
}

await Bun.$`mkdir -p ${OUT_DIR}`.quiet();

const manifest: {
  kind: string;
  title: string;
  query: string;
  image: string | null;
  content: string | null;
}[] = [];

for (const sample of SAMPLES) {
  const plan = parseAndCompile(sample.query.replaceAll("\n", " "));
  const output = await renderReportOutput({
    title: sample.title,
    result: {
      plan,
      columns: sample.columns,
      rows: project(sample.rows, sample.columns),
      rowsScanned: 1031,
    },
    // Fixed instant: the renderer stamps nothing time-dependent into these
    // samples, and a fixed value keeps regeneration byte-stable for the drift
    // check.
    startedAt: new Date(0),
  });

  const imageName = output.image === null ? null : `render-${sample.kind}.png`;
  if (imageName !== null && output.image !== null) {
    await Bun.write(path.join(OUT_DIR, imageName), output.image.data);
  }
  manifest.push({
    kind: sample.kind,
    title: sample.title,
    query: sample.query,
    image: imageName,
    content: output.image === null ? output.content : null,
  });
  console.log(
    `${sample.kind.padEnd(14)} ${imageName ?? `${output.content.length.toString()} chars of message text`}`,
  );
}

await Bun.write(
  path.join(OUT_DIR, "render-samples.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`\nWrote ${manifest.length.toString()} samples to ${OUT_DIR}`);

// ── Competition leaderboard chart ────────────────────────────────────────────
// Rendered with the same chart library the competition lifecycle posts to
// Discord (`competitionChartToImage`), and the same subtitle helper
// (`formatCriteriaDescription`). The backend's own `renderCompetitionChartBuffer`
// wrapper is deliberately not used here: it pulls in the metrics module, which
// requires full runtime configuration (Discord token included) that a docs
// generator has no business holding.
const { competitionChartToImage } = await import("@scout-for-lol/report");
const { formatCriteriaDescription } =
  await import("@scout-for-lol/backend/discord/embeds/competition-format-helpers.ts");

const CRITERIA = CompetitionCriteriaSchema.parse({
  type: "MOST_GAMES_PLAYED",
  queues: ["ALL"],
});

const STANDINGS = [
  ["Faker", 146],
  ["Caps", 111],
  ["Chovy", 90],
  ["Ruler", 89],
  ["Keria", 76],
  ["Zeus", 71],
  ["Oner", 64],
  ["Knight", 58],
] as const;

const competitionChart = await competitionChartToImage({
  chartType: "bar",
  title: "Summer Grind Race",
  subtitle: formatCriteriaDescription(CRITERIA),
  // Mirrors valueAxisLabelForCriteria(MOST_GAMES_PLAYED) in
  // backend/src/league/competition/chart-builder.ts; asserted by
  // src/docs-site.test.ts so a rename there fails this build.
  yAxisLabel: "Games",
  bars: STANDINGS.map(([playerName, value]) => ({ playerName, value })),
});

await Bun.write(
  path.join(OUT_DIR, "competition-leaderboard.png"),
  competitionChart,
);
console.log("competition    competition-leaderboard.png");
