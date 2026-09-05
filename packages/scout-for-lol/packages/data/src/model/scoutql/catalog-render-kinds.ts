import {
  ReportOutputFormatSchema,
  type ReportOutputFormat,
} from "#src/model/reports/report.ts";

// ── ScoutQL v2 render-kind catalog ───────────────────────────────────────────
// What `RENDER <kind>` accepts, with the labels and descriptions the docs site,
// the in-app reference, and the AI language payload all read.
//
// Keyed by ReportOutputFormat as a total Record, so adding a render kind to the
// schema without describing it here is a typecheck failure rather than a page
// that silently omits it. The legacy registry was a hand-maintained array and
// had already fallen behind: HISTOGRAM and BOX_PLOT existed in the schema and
// in the renderer while the array listed neither.

export type ScoutQlRenderKindInfo = {
  /** The lowercase token an author writes: `RENDER bar_chart`. */
  id: string;
  format: ReportOutputFormat;
  label: string;
  description: string;
  /** Charts render to an image and accept encodings; text kinds do not. */
  isChart: boolean;
};

type RenderKindDetail = {
  label: string;
  description: string;
  isChart: boolean;
};

const RENDER_KIND_DETAIL: Record<ReportOutputFormat, RenderKindDetail> = {
  TABLE: {
    label: "Table",
    description: "Plain data table.",
    isChart: false,
  },
  LIST: {
    label: "List",
    description: "Bulleted text list.",
    isChart: false,
  },
  LEADERBOARD: {
    label: "Leaderboard",
    description: "Ranked leaderboard text, optionally @mentioning top rows.",
    isChart: false,
  },
  BAR_CHART: {
    label: "Bar chart",
    description: "Categorical bar chart.",
    isChart: true,
  },
  LINE_CHART: {
    label: "Line chart",
    description: "Categorical or temporal line chart.",
    isChart: true,
  },
  STACKED_BAR: {
    label: "Stacked bar",
    description: "Stacked multi-output bar chart.",
    isChart: true,
  },
  AREA_CHART: {
    label: "Area chart",
    description: "Filled categorical or temporal trend.",
    isChart: true,
  },
  DONUT_CHART: {
    label: "Donut chart",
    description: "Part-to-whole chart for bounded rows.",
    isChart: true,
  },
  SCATTER_CHART: {
    label: "Scatter chart",
    description: "Compare two outputs, optionally sized by a third.",
    isChart: true,
  },
  HEATMAP: {
    label: "Heatmap",
    description: "Two-dimensional matrix colored by an output.",
    isChart: true,
  },
  RADAR_CHART: {
    label: "Radar chart",
    description: "Compare three to eight normalized outputs.",
    isChart: true,
  },
  KPI_CARD: {
    label: "KPI card",
    description: "One aggregate row displayed as metric cards.",
    isChart: true,
  },
  BUMP_CHART: {
    label: "Bump chart",
    description: "Rank-position movement over time.",
    isChart: true,
  },
  CALENDAR_HEATMAP: {
    label: "Calendar heatmap",
    description: "Daily activity or performance on a calendar grid.",
    isChart: true,
  },
  HISTOGRAM: {
    label: "Histogram",
    description:
      "Distribution over a numeric bucket grouping, such as FLOOR(game_duration_seconds / 300) * 300.",
    isChart: true,
  },
  BOX_PLOT: {
    label: "Box plot",
    description:
      "Five-number summary per group: min, q1, median, q3 and max, named in that order as y.",
    isChart: true,
  },
};

/** The token an author writes for a render kind: `BAR_CHART` → `bar_chart`. */
export function renderKindToken(format: ReportOutputFormat): string {
  return format.toLowerCase();
}

export const SCOUTQL_RENDER_KINDS: readonly ScoutQlRenderKindInfo[] =
  ReportOutputFormatSchema.options.map((format) => {
    const detail = RENDER_KIND_DETAIL[format];
    return {
      id: renderKindToken(format),
      format,
      label: detail.label,
      description: detail.description,
      isChart: detail.isChart,
    };
  });

export function scoutQlRenderKind(
  format: ReportOutputFormat,
): ScoutQlRenderKindInfo {
  const found = SCOUTQL_RENDER_KINDS.find((kind) => kind.format === format);
  if (found === undefined) {
    // Unreachable while the Record above is total; a missing entry is a bug in
    // this module, not bad input.
    throw new Error(`No render-kind catalog entry for ${format}.`);
  }
  return found;
}

export function isChartRenderKind(format: ReportOutputFormat): boolean {
  return RENDER_KIND_DETAIL[format].isChart;
}
