import {
  type ReportAiPreviewSummary,
  type ReportResultColumn,
  type ReportOutputFormat,
  type VisualizationSnapshot,
  VisualizationSnapshotSchema,
  UNGROUPED_LABEL_COLUMN_LABEL,
} from "@scout-for-lol/data";
import { isChartRenderKind } from "@scout-for-lol/data/model/scoutql/catalog-render-kinds.ts";

export function plottableMetricColumns(
  columns: ReportResultColumn[],
): ReportResultColumn[] {
  return columns.filter(
    (col) =>
      col.key !== "label" &&
      (col.format === "percent" ||
        col.format === "integer" ||
        col.format === "decimal"),
  );
}

export function isChartablePreview(
  preview: ReportAiPreviewSummary | null,
): boolean {
  if (preview === null || preview.rows.length === 0) {
    return false;
  }
  // Ungrouped scalar results (e.g. single row labelled "All") are figures, not charts.
  const isUngrouped =
    preview.rows.length === 1 &&
    preview.columns.some(
      (col) =>
        col.key === "label" && col.label === UNGROUPED_LABEL_COLUMN_LABEL,
    );
  if (isUngrouped) {
    return false;
  }

  const numericCols = plottableMetricColumns(preview.columns);
  if (numericCols.length > 0) {
    return true;
  }

  // Check if any non-label value is numeric
  return preview.rows.some((row) =>
    row.values.some(
      (entry) => entry.column !== "label" && typeof entry.value === "number",
    ),
  );
}

export type PreviewToVisualizationOptions = {
  baseSnapshot?: VisualizationSnapshot | undefined;
  preferredKind?: ReportOutputFormat | undefined;
  metricKey?: string | undefined;
  orientation?: ("horizontal" | "vertical") | undefined;
};

export function previewToVisualizationSnapshot(
  preview: ReportAiPreviewSummary,
  options?: PreviewToVisualizationOptions,
): VisualizationSnapshot | null {
  if (!isChartablePreview(preview)) {
    return null;
  }

  const selectedMetric = selectedMetricForPreview(preview, options);

  if (selectedMetric === undefined) {
    return null;
  }

  const baseSnapshot = options?.baseSnapshot;
  const series =
    baseSnapshot?.series.find((item) => item.metric === selectedMetric.key) ??
    previewMetricSeries(preview, selectedMetric);
  const targetKind = targetVisualizationKind(preview, options?.preferredKind);
  const snapshot = baseSnapshot ?? emptyVisualizationSnapshot();
  const withControls = visualizationSnapshotWithControls(snapshot, {
    preferredKind: targetKind,
    orientation: options?.orientation,
  });
  return VisualizationSnapshotSchema.parse({
    ...withControls,
    series: [series],
  });
}

export function visualizationSnapshotWithControls(
  snapshot: VisualizationSnapshot,
  options: {
    preferredKind: string;
    orientation: "horizontal" | "vertical" | undefined;
  },
): VisualizationSnapshot {
  const currentOptions = snapshot.display.options;
  const orientation =
    options.orientation ?? currentOptions?.orientation ?? "vertical";
  const displayOptions =
    currentOptions === null || currentOptions === undefined
      ? { orientation }
      : { ...currentOptions, orientation };

  return VisualizationSnapshotSchema.parse({
    ...snapshot,
    kind: options.preferredKind,
    display: {
      ...snapshot.display,
      options: displayOptions,
    },
  });
}

function selectedMetricForPreview(
  preview: ReportAiPreviewSummary,
  options: PreviewToVisualizationOptions | undefined,
): ReportResultColumn | undefined {
  const plottableCols = plottableMetricColumns(preview.columns);
  if (options?.metricKey === undefined) return plottableCols[0];
  return (
    preview.columns.find((col) => col.key === options.metricKey) ??
    plottableCols[0]
  );
}

function previewMetricSeries(
  preview: ReportAiPreviewSummary,
  selectedMetric: ReportResultColumn,
) {
  const rows =
    preview.visualizationRows.length > 0
      ? preview.visualizationRows
      : preview.rows;
  const points = rows.map((row) => {
    const entry = row.values.find((val) => val.column === selectedMetric.key);
    const numericValue = typeof entry?.value === "number" ? entry.value : null;
    const games = row.games ?? 0;
    return {
      key: row.label,
      label: row.label,
      start: "1970-01-01T00:00:00.000Z",
      end: "1970-01-01T00:00:00.000Z",
      value: numericValue,
      evidence: {
        sampleSize: games,
        ...(row.games === undefined ? {} : { games: row.games }),
      },
    };
  });

  return {
    id: selectedMetric.key,
    label: selectedMetric.label,
    metric: selectedMetric.key,
    displayKind: metricDisplayKind(selectedMetric),
    additive: false,
    points,
  };
}

function metricDisplayKind(
  column: ReportResultColumn,
): "percent" | "count" | "decimal" {
  if (column.format === "percent") return "percent";
  if (column.format === "integer") return "count";
  return "decimal";
}

function targetVisualizationKind(
  preview: ReportAiPreviewSummary,
  preferredKind: ReportOutputFormat | undefined,
): string {
  if (preferredKind !== undefined && isChartRenderKind(preferredKind)) {
    return preferredKind;
  }
  if (isChartRenderKind(preview.renderKind)) return preview.renderKind;
  return "BAR_CHART";
}

function emptyVisualizationSnapshot(): VisualizationSnapshot {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: "BAR_CHART",
    title: null,
    temporal: null,
    bucket: null,
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
    series: [],
    annotations: [],
    trends: [],
  };
}
