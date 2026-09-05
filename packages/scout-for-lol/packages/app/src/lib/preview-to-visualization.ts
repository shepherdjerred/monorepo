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

  const plottableCols = plottableMetricColumns(preview.columns);
  const selectedMetric =
    options?.metricKey === undefined
      ? plottableCols[0]
      : (preview.columns.find((col) => col.key === options.metricKey) ??
        plottableCols[0]);

  if (selectedMetric === undefined) {
    return null;
  }

  const metricKey = selectedMetric.key;
  const rows =
    preview.visualizationRows.length > 0
      ? preview.visualizationRows
      : preview.rows;

  const points = rows.map((row) => {
    const entry = row.values.find((val) => val.column === metricKey);
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

  let displayKind: "percent" | "count" | "decimal" = "decimal";
  if (selectedMetric.format === "percent") {
    displayKind = "percent";
  } else if (selectedMetric.format === "integer") {
    displayKind = "count";
  }

  const series = {
    id: selectedMetric.key,
    label: selectedMetric.label,
    metric: selectedMetric.key,
    displayKind,
    additive: false,
    points,
  };

  let targetKind = "BAR_CHART";
  if (
    options?.preferredKind !== undefined &&
    isChartRenderKind(options.preferredKind)
  ) {
    targetKind = options.preferredKind;
  } else if (isChartRenderKind(preview.renderKind)) {
    targetKind = preview.renderKind;
  }

  return VisualizationSnapshotSchema.parse({
    version: 1,
    generatedAt: new Date().toISOString(),
    kind: targetKind,
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
      options: {
        orientation: options?.orientation ?? "vertical",
      },
    },
    series: [series],
    annotations: [],
    trends: [],
  });
}
