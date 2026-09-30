import {
  ExploreConversationSchema,
  ReportAiPreviewSummarySchema,
  VisualizationSnapshotSchema,
  type ExploreConversation,
  type ReportAiPreviewSummary,
  type ReportOutputFormat,
  type ReportResultColumn,
  type VisualizationAnnotation,
  type VisualizationSnapshot,
  type VisualizationTrend,
} from "@scout-for-lol/data";

/**
 * Fixtures shared by the app's stories — and, where a test asserts against the
 * same shape, by that test too.
 *
 * Everything here goes through the real schema, so a fixture that drifts from
 * the contract fails at build time instead of rendering a story nobody could
 * ever see in the product.
 */

type PreviewRow = ReportAiPreviewSummary["rows"][number];

/**
 * A same-origin stand-in for a Discord CDN avatar URL. The catalog's CSP
 * intentionally allows no third-party host — `img-src` is `'self' data:
 * blob:` — so a real `cdn.discordapp.com` URL renders broken in the published
 * catalog even though it works from a developer's browser, which already has
 * the asset cached or an open connection to Discord.
 */
export function placeholderAvatar(fill: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="40" fill="${fill}"/></svg>`,
  )}`;
}

/**
 * A conversation as the sidebar lists it, `minutesAgo` behind now so recency
 * bucketing ("Today", "Last week") is what the story is actually showing.
 */
export function storyConversation(
  id: string,
  title: string,
  minutesAgo: number,
): ExploreConversation {
  const updatedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return ExploreConversationSchema.parse({
    id,
    title,
    shareToken: null,
    sharedLeafId: null,
    createdAt: updatedAt,
    updatedAt,
  });
}

/** The champion / win-rate / games shape a grouped ScoutQL result comes back in. */
export const CHAMPION_WIN_RATE_COLUMNS: ReportResultColumn[] = [
  { key: "label", label: "Champion", format: "text" },
  { key: "win_rate", label: "Win rate", format: "percent" },
  { key: "games", label: "Games", format: "integer" },
];

/** One champion's row of that result. */
export function championWinRateRow(
  label: string,
  games: number,
  winRate: number,
): PreviewRow {
  return {
    label,
    games,
    values: [
      { column: "win_rate", value: winRate },
      { column: "games", value: games },
    ],
  };
}

/**
 * A grouped champion result. `rowsReturned` follows the rows given, which is
 * what the engine reports for a preview that fits under the row cap.
 */
export function championWinRatePreview(input: {
  rows: readonly PreviewRow[];
  rowsScanned: number;
  renderKind: ReportOutputFormat;
}): ReportAiPreviewSummary {
  return ReportAiPreviewSummarySchema.parse({
    columns: CHAMPION_WIN_RATE_COLUMNS,
    rows: input.rows,
    visualizationRows: [],
    rowsReturned: input.rows.length,
    rowsScanned: input.rowsScanned,
    renderKind: input.renderKind,
  });
}

/** A patch bucket on the win-rate series: the label is the patch itself. */
export type StoryPatchPoint = {
  patch: string;
  start: string;
  end: string;
  value: number;
  sampleSize: number;
};

/**
 * A persisted win-rate-by-patch line chart: one percent series bucketed by
 * patch over a relative 30-day window, with no display overrides.
 *
 * Annotations and trends default to empty because that is what a freshly
 * charted result carries; a test proving persisted metadata is dropped passes
 * its own.
 */
export function winRateByPatchChart(input: {
  title: string;
  points: readonly StoryPatchPoint[];
  annotations?: readonly VisualizationAnnotation[];
  trends?: readonly VisualizationTrend[];
}): VisualizationSnapshot {
  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: "2026-08-14T12:00:30.000Z",
    kind: "LINE_CHART",
    title: input.title,
    temporal: {
      window: { kind: "relative", days: 30 },
      bucket: "patch",
      timezone: "UTC",
    },
    bucket: "patch",
    display: {
      theme: null,
      palette: null,
      smooth: false,
      stack: "none",
      rollingWindow: null,
      cumulative: false,
      sparkline: false,
      options: null,
    },
    series: [
      {
        id: "win_rate",
        label: "Win rate",
        metric: "win_rate",
        displayKind: "percent",
        additive: false,
        points: input.points.map((point) => ({
          key: point.patch,
          label: point.patch,
          start: point.start,
          end: point.end,
          value: point.value,
          evidence: { sampleSize: point.sampleSize },
        })),
      },
    ],
    annotations: input.annotations ?? [],
    trends: input.trends ?? [],
  });
}
