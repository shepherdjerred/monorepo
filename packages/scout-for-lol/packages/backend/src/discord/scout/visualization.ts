import { AttachmentBuilder, Colors, EmbedBuilder } from "discord.js";
import {
  formatReportDisplayValue,
  REPORT_METRICS,
  type ExploreMessage,
  type ReportAiPreviewSummary,
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { visualizationSnapshotToImage } from "@scout-for-lol/report";

const NATIVE_KINDS = new Set(["TABLE", "LIST", "LEADERBOARD", "KPI_CARD"]);
const MAX_NATIVE_ROWS = 12;
const MAX_EMBED_DESCRIPTION = 3900;
const MAX_EMBED_TITLE = 256;
const DESCRIPTION_TRUNCATION_SUFFIX =
  "\n\n_Visualization truncated to fit Discord._";

export type ExploreVisualizationPayload = {
  files?: AttachmentBuilder[];
  embeds?: EmbedBuilder[];
};

export function exploreVisualizationPayload(
  message: ExploreMessage,
): ExploreVisualizationPayload {
  const snapshot = message.visualization;
  if (snapshot === null) {
    return {};
  }
  if (usesNativeDiscordVisualization(snapshot)) {
    const embed = visualizationToEmbed(snapshot, message.preview);
    return embed === null ? {} : { embeds: [embed] };
  }
  return {
    files: [
      new AttachmentBuilder(visualizationSnapshotToImage(snapshot), {
        name: "scout-explore.png",
      }),
    ],
  };
}

export function exploreChartAttachment(
  message: ExploreMessage,
): AttachmentBuilder | null {
  return exploreVisualizationPayload(message).files?.[0] ?? null;
}

export function usesNativeDiscordVisualization(
  snapshot: VisualizationSnapshot,
): boolean {
  return NATIVE_KINDS.has(snapshot.kind) && !snapshot.display.sparkline;
}

export function visualizationToEmbed(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null = null,
): EmbedBuilder | null {
  const description = nativeDescription(snapshot, preview);
  if (description === null) {
    return null;
  }
  const embed = new EmbedBuilder()
    .setColor(Colors.DarkGold)
    .setDescription(description);
  if (snapshot.title !== null) {
    embed.setTitle(truncateTitle(snapshot.title));
  }
  return embed;
}

function truncateTitle(title: string): string {
  if (title.length <= MAX_EMBED_TITLE) {
    return title;
  }
  return `${title.slice(0, MAX_EMBED_TITLE - 1)}…`;
}

function nativeDescription(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): string | null {
  if (snapshot.series.length === 0) {
    const hasPreviewRows = preview !== null && previewRows(preview).length > 0;
    if (!hasPreviewRows || snapshot.kind === "KPI_CARD") {
      return "No results found.";
    }
  }
  const description =
    snapshot.kind === "KPI_CARD"
      ? formatKpi(snapshot)
      : snapshot.kind === "LEADERBOARD"
        ? formatLeaderboard(snapshot, preview)
        : snapshot.kind === "LIST"
          ? formatList(snapshot, preview)
          : formatTable(snapshot, preview);
  return snapshot.kind === "TABLE"
    ? truncateTableDescription(description)
    : truncateDescription(description);
}

function truncateDescription(description: string): string {
  if (description.length <= MAX_EMBED_DESCRIPTION) {
    return description;
  }
  const available =
    MAX_EMBED_DESCRIPTION - DESCRIPTION_TRUNCATION_SUFFIX.length;
  return `${truncateLines(description, available)}${DESCRIPTION_TRUNCATION_SUFFIX}`;
}

function truncateTableDescription(description: string): string {
  const codeFence = "```";
  const openingFence = `${codeFence}\n`;
  const closingFence = `\n${codeFence}`;
  const fullDescription = `${openingFence}${description}${closingFence}`;
  if (fullDescription.length <= MAX_EMBED_DESCRIPTION) {
    return fullDescription;
  }
  const available =
    MAX_EMBED_DESCRIPTION -
    openingFence.length -
    closingFence.length -
    DESCRIPTION_TRUNCATION_SUFFIX.length;
  const truncated = truncateLines(description, available);
  return `${openingFence}${truncated}${closingFence}${DESCRIPTION_TRUNCATION_SUFFIX}`;
}

function truncateLines(description: string, available: number): string {
  const lines: string[] = [];
  let length = 0;
  for (const line of description.split("\n")) {
    const nextLength = length + (lines.length === 0 ? 0 : 1) + line.length;
    if (nextLength > available) {
      break;
    }
    lines.push(line);
    length = nextLength;
  }
  const prefix = lines.join("\n");
  if (prefix.length === 0) {
    return description.slice(0, available);
  }
  return prefix;
}

function formatKpi(snapshot: VisualizationSnapshot): string {
  return snapshot.series
    .map((series) => {
      const point = series.points.at(-1);
      if (point === undefined) {
        return `**${escapeMarkdown(series.label)}**\nUnknown n=0`;
      }
      const value = formatSeriesValue(snapshot, series, point.value);
      const sampleSize = point.evidence.sampleSize;
      const comparison =
        snapshot.temporal?.comparison !== undefined ||
        point.comparisonEvidence !== undefined;
      const details = comparison
        ? `n=${sampleSize.toString()} · Baseline: ${formatSeriesValue(
            snapshot,
            series,
            point.comparisonValue ?? null,
          )} · Δ ${formatAbsoluteDelta(
            snapshot,
            series,
            point.absoluteDelta ?? null,
          )} · ${formatPercent(point.percentageDelta ?? null)}`
        : `n=${sampleSize.toString()}`;
      return `**${escapeMarkdown(series.label)}**\n${value} ${details}`;
    })
    .join("\n\n");
}

function formatList(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): string {
  const allRows =
    preview === null ? alignedRows(snapshot) : previewRows(preview);
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const previewExtra = hasPreviewRowsBeyondStoredRows(preview, allRows);
  const lines = rows.map((row) => {
    const values = formatRowValues(snapshot, row, preview).join(", ");
    return `- ${escapeMarkdown(row.label)}: ${values}`;
  });
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more_`);
  } else if (previewExtra) {
    lines.push("_…additional rows omitted from the stored preview_");
  }
  return lines.join("\n");
}

function formatLeaderboard(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): string {
  const allRows =
    preview === null ? alignedRows(snapshot) : previewRows(preview);
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const previewExtra = hasPreviewRowsBeyondStoredRows(preview, allRows);
  const lines = rows.map((row, index) => {
    const values = formatRowValues(snapshot, row, preview).join(" · ");
    return `**${(index + 1).toString()}.** ${escapeMarkdown(row.label)} — ${values}`;
  });
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more_`);
  } else if (previewExtra) {
    lines.push("_…additional rows omitted from the stored preview_");
  }
  return lines.join("\n");
}

function formatTable(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): string {
  const allRows =
    preview === null ? alignedRows(snapshot) : previewRows(preview);
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const previewExtra = hasPreviewRowsBeyondStoredRows(preview, allRows);
  const headers =
    preview === null
      ? ["", ...snapshot.series.map((series) => series.label)]
      : preview.columns.map((column) => column.label);
  const lines = [
    headers.map((header) => escapeTableCell(header)).join("    "),
    headers.map(() => "----").join("    "),
    ...rows.map((row) =>
      [
        escapeTableCell(row.label),
        ...(preview === null
          ? snapshot.series.map((series) =>
              escapeTableCell(
                formatSeriesValue(
                  snapshot,
                  series,
                  requireNumericRowValue(row, series.id),
                ),
              ),
            )
          : previewMetricColumns(preview).map((column) =>
              escapeTableCell(
                formatPreviewValue(column, requireRowValue(row, column.key)),
              ),
            )),
      ].join("    "),
    ),
  ];
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more rows_`);
  } else if (previewExtra) {
    lines.push("_…additional rows omitted from the stored preview_");
  }
  return lines.join("\n");
}

type NativeRowValue = string | number | null;
type NativeRow = {
  label: string;
  values: Map<string, NativeRowValue>;
};

function alignedRows(snapshot: VisualizationSnapshot): NativeRow[] {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const values = new Map<string, Map<string, NativeRowValue>>();
  for (const series of snapshot.series) {
    for (const point of series.points) {
      if (!labels.has(point.key)) {
        order.push(point.key);
        labels.set(point.key, point.label);
        values.set(point.key, new Map());
      }
      const rowValues = values.get(point.key);
      if (rowValues === undefined) {
        throw new Error(`Visualization row missing key ${point.key}.`);
      }
      rowValues.set(series.id, point.value);
    }
  }
  return order.map((key) => {
    const label = labels.get(key);
    if (label === undefined) {
      throw new Error(`Visualization label missing key ${key}.`);
    }
    const rowValues = values.get(key);
    if (rowValues === undefined) {
      throw new Error(`Visualization values missing key ${key}.`);
    }
    return { label, values: rowValues };
  });
}

function previewRows(preview: ReportAiPreviewSummary): NativeRow[] {
  const rows =
    preview.visualizationRows.length > 0
      ? preview.visualizationRows
      : preview.rows;
  return rows.map((row) => ({
    label: row.label,
    values: new Map(row.values.map((value) => [value.column, value.value])),
  }));
}

function hasPreviewRowsBeyondStoredRows(
  preview: ReportAiPreviewSummary | null,
  rows: NativeRow[],
): boolean {
  return preview !== null && preview.rowsReturned > rows.length;
}

function previewMetricColumns(preview: ReportAiPreviewSummary) {
  return preview.columns.filter((column) => column.key !== "label");
}

function formatRowValues(
  snapshot: VisualizationSnapshot,
  row: NativeRow,
  preview: ReportAiPreviewSummary | null,
): string[] {
  if (preview !== null) {
    return previewMetricColumns(preview).map(
      (column) =>
        `${escapeMarkdown(column.label)}: ${formatPreviewValue(
          column,
          requireRowValue(row, column.key),
        )}`,
    );
  }
  return snapshot.series.map(
    (series) =>
      `${escapeMarkdown(series.label)}: ${formatSeriesValue(
        snapshot,
        series,
        requireNumericRowValue(row, series.id),
      )}`,
  );
}

function requireRowValue(row: NativeRow, column: string): NativeRowValue {
  return row.values.get(column) ?? null;
}

function requireNumericRowValue(row: NativeRow, column: string): number | null {
  const value = requireRowValue(row, column);
  if (typeof value !== "number" && value !== null) {
    throw new Error(`Visualization row value for ${column} is not numeric.`);
  }
  return value;
}

function formatPreviewValue(
  column: ReportAiPreviewSummary["columns"][number],
  value: NativeRowValue,
): string {
  if (value === null) {
    return "Unknown";
  }
  return formatReportDisplayValue(column, value);
}

function formatSeriesValue(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  if (value === null) {
    return "Unknown";
  }
  const isRate =
    snapshot.display.stack === "percent" ||
    REPORT_METRICS.find((metric) => metric.id === series.metric)?.kind ===
      "rate";
  if (isRate) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
    value,
  );
}

function formatAbsoluteDelta(
  snapshot: VisualizationSnapshot,
  series: TemporalSeries,
  value: number | null,
): string {
  const isRate =
    snapshot.display.stack === "percent" ||
    REPORT_METRICS.find((metric) => metric.id === series.metric)?.kind ===
      "rate";
  if (isRate) {
    return value === null ? "Unknown" : `${(value * 100).toFixed(1)} pp`;
  }
  return formatSeriesValue(snapshot, series, value);
}

function formatPercent(value: number | null): string {
  return value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll(/[\r\n]+/g, " ")
    .replaceAll(/[\\_*`|]/g, (char) => `\\${char}`);
}

function escapeTableCell(value: string): string {
  return value
    .replaceAll("`", "′")
    .replaceAll("|", String.raw`\|`)
    .replaceAll("\n", " ");
}
