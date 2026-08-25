/**
 * Regenerate one sample per ScoutQL `RENDER` kind, using Scout's real report
 * renderer.
 *
 * The samples are not mock-ups. Each query in `render-sample-data.ts` is
 * compiled by `compileScoutQl` — the same compiler the backend runs — and the
 * resulting plan is driven through `buildVisualizationSnapshot` and
 * `renderReportOutput`, which is exactly the path that produces what Scout
 * posts to Discord. Chart kinds emit the PNG the bot would attach; text kinds
 * emit the literal message content.
 *
 * Because the kind list is read from `SCOUTQL_RENDER_KINDS`, adding a render
 * kind without adding a sample here fails this script, and the committed
 * output is checked for drift in CI (`bun run generate` + a clean git tree).
 *
 * Run: bun run generate
 */
import path from "node:path";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import { SCOUTQL_RENDER_KINDS } from "@scout-for-lol/data/model/scoutql/catalog-render-kinds.ts";
import { renderReportOutput } from "@scout-for-lol/backend/reports/output.ts";
import { planResultColumnNames } from "@scout-for-lol/backend/reports/plan-columns.ts";
import {
  resolveTemporalContext,
  windowRange,
} from "@scout-for-lol/backend/reports/temporal-plan.ts";
import { buildVisualizationSnapshot } from "@scout-for-lol/backend/reports/visualization-snapshot.ts";
import type { ReportQueryResult } from "@scout-for-lol/backend/reports/query-types.ts";
import { RENDER_SAMPLES } from "./render-sample-data.ts";

const OUT_DIR = path.join(import.meta.dir, "..", "src", "assets", "generated");

/**
 * A fixed "now". Relative windows resolve against it, so pinning it is what
 * keeps regeneration byte-stable: a moving clock would shift every weekly
 * bucket label and rewrite every temporal PNG on each run.
 */
const NOW = new Date("2026-08-03T12:00:00.000Z");

const declared = new Set(RENDER_SAMPLES.map((sample) => sample.kind));
const missing = SCOUTQL_RENDER_KINDS.filter(
  (kind) => !declared.has(kind.id),
).map((kind) => kind.id);
if (missing.length > 0) {
  throw new Error(
    `No docs sample defined for render kind(s): ${missing.join(", ")}. ` +
      `Add an entry to RENDER_SAMPLES in scripts/render-sample-data.ts.`,
  );
}
const unknown = [...declared].filter(
  (id) => !SCOUTQL_RENDER_KINDS.some((kind) => kind.id === id),
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

for (const sample of RENDER_SAMPLES) {
  const plan = compileScoutQl(sample.query);
  const range = windowRange(plan.timeWindow, NOW);
  const temporal = resolveTemporalContext(plan, range);
  const base: ReportQueryResult = {
    plan,
    columns: planResultColumnNames(plan),
    rows: sample.rows({ plan, range }),
    rowsScanned: 1031,
    range,
    ...(temporal === null ? {} : { temporal }),
  };
  const result: ReportQueryResult = {
    ...base,
    visualization: buildVisualizationSnapshot(base, NOW),
  };
  const output = await renderReportOutput({
    title: sample.title,
    result,
    startedAt: NOW,
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
    `${sample.kind.padEnd(16)} ${imageName ?? `${output.content.length.toString()} chars of message text`}`,
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
// wrapper is deliberately not used here: it requires full runtime configuration
// (Discord token included) that a docs generator has no business holding.
const { competitionChartToImage } = await import("@scout-for-lol/report");
const { formatCriteriaDescription } =
  await import("@scout-for-lol/backend/discord/embeds/competition-format-helpers.ts");

const CRITERIA = { type: "MOST_GAMES_PLAYED", queue: "ALL" } as const;

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
console.log("competition      competition-leaderboard.png");
