import {
  AttachmentBuilder,
  Colors,
  EmbedBuilder,
  escapeMarkdown as escapeDiscordMarkdown,
} from "discord.js";
import {
  type ExploreMessage,
  type ReportAiPreviewSummary,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { visualizationSnapshotToImage } from "@scout-for-lol/report";
import {
  formatAbsoluteDelta,
  formatNativeSeriesValue,
  formatPreviewValue,
  formatSeriesValue,
  requireRowValue,
  type NativeRow,
  type NativeRowValue,
} from "#src/discord/scout/visualization-format.ts";

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
  const hasSnapshotPoints = snapshot.series.some(
    (series) => series.points.length > 0,
  );
  const hasPreviewRows =
    snapshot.temporal === null &&
    preview !== null &&
    previewRows(preview).length > 0;
  if (
    !hasSnapshotPoints &&
    !hasPreviewRows &&
    (snapshot.kind !== "KPI_CARD" || snapshot.series.length === 0)
  ) {
    return "No results found.";
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
  const description = snapshot.series
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
          )} · ${
            point.percentageDelta === null ||
            point.percentageDelta === undefined
              ? "Unknown"
              : `${(point.percentageDelta * 100).toFixed(1)}%`
          }`
        : `n=${sampleSize.toString()}`;
      return `**${escapeMarkdown(series.label)}**\n${value} ${details}`;
    })
    .join("\n\n");
  const subtitle = snapshot.display.options?.subtitle;
  return subtitle === undefined
    ? description
    : `${description}\n\n${escapeMarkdown(subtitle)}`;
}

function formatList(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): string {
  const source = nativeRowSource(snapshot, preview);
  const allRows = source.rows;
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const previewNotice = previewOverflowNotice(
    source.preview,
    allRows,
    source.snapshotRows,
    snapshot,
  );
  const lines = rows.map((row) => {
    const values = formatRowValues(snapshot, row, source.preview).join(", ");
    return `- ${escapeMarkdown(row.label)}: ${values}`;
  });
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more_`);
  } else if (previewNotice !== null) {
    lines.push(previewNotice);
  }
  return lines.join("\n");
}

function formatLeaderboard(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): string {
  const source = nativeRowSource(snapshot, preview);
  const allRows = source.rows;
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const previewNotice = previewOverflowNotice(
    source.preview,
    allRows,
    source.snapshotRows,
    snapshot,
  );
  const lines = rows.map((row, index) => {
    const values = formatRowValues(snapshot, row, source.preview).join(" · ");
    return `**${(index + 1).toString()}.** ${escapeMarkdown(row.label)} — ${values}`;
  });
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more_`);
  } else if (previewNotice !== null) {
    lines.push(previewNotice);
  }
  return lines.join("\n");
}

function formatTable(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): string {
  const source = nativeRowSource(snapshot, preview);
  const allRows = source.rows;
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const previewNotice = previewOverflowNotice(
    source.preview,
    allRows,
    source.snapshotRows,
    snapshot,
  );
  const headers =
    source.preview === null
      ? ["", ...snapshot.series.map((series) => series.label)]
      : source.preview.columns.map((column) => column.label);
  const escapedHeaders = headers.map((header) => escapeTableCell(header));
  const bodyRows = rows.map((row) => [
    escapeTableCell(row.label),
    ...(source.preview === null
      ? snapshot.series.map((series) =>
          escapeTableCell(formatNativeSeriesValue(snapshot, series, row)),
        )
      : previewMetricColumns(source.preview).map((column) =>
          escapeTableCell(
            formatPreviewValue(column, requireRowValue(row, column.key)),
          ),
        )),
  ]);
  const widths = headers.map((_, index) =>
    Math.max(
      displayWidth(escapedHeaders[index] ?? ""),
      ...bodyRows.map((row) => displayWidth(row[index] ?? "")),
    ),
  );
  const lines = [
    formatTableRow(escapedHeaders, widths),
    formatTableRow(
      widths.map((width) => "-".repeat(width)),
      widths,
    ),
    ...bodyRows.map((row) => formatTableRow(row, widths)),
  ];
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more rows_`);
  } else if (previewNotice !== null) {
    lines.push(previewNotice);
  }
  return lines.join("\n");
}

function formatTableRow(cells: string[], widths: number[]): string {
  return cells
    .map((cell, index) =>
      padDisplayWidth(cell, widths[index] ?? displayWidth(cell)),
    )
    .join("    ");
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

function displayWidth(value: string): number {
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(value)) {
    for (const character of segment) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) {
        continue;
      }
      if (
        codePoint === 0x20_0d ||
        /\p{Mark}/u.test(character) ||
        (codePoint >= 0xfe_00 && codePoint <= 0xfe_0f)
      ) {
        continue;
      }
      width += isWideCodePoint(codePoint) ? 2 : 1;
      break;
    }
  }
  return width;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x11_00 && codePoint <= 0x11_5f) ||
    codePoint === 0x23_29 ||
    codePoint === 0x23_2a ||
    (codePoint >= 0x2e_80 && codePoint <= 0xa4_cf) ||
    (codePoint >= 0xac_00 && codePoint <= 0xd7_a3) ||
    (codePoint >= 0xf9_00 && codePoint <= 0xfa_ff) ||
    (codePoint >= 0xfe_10 && codePoint <= 0xfe_19) ||
    (codePoint >= 0xfe_30 && codePoint <= 0xfe_6f) ||
    (codePoint >= 0xff_00 && codePoint <= 0xff_60) ||
    (codePoint >= 0xff_e0 && codePoint <= 0xff_e6) ||
    (codePoint >= 0x1_f3_00 && codePoint <= 0x1_fa_ff)
  );
}

function padDisplayWidth(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

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
    return { key, label, values: rowValues };
  });
}

function previewRows(preview: ReportAiPreviewSummary): NativeRow[] {
  const rows =
    preview.visualizationRows.length > 0
      ? preview.visualizationRows
      : preview.rows;
  return rows.map((row) => ({
    key: row.label,
    label: row.label,
    values: new Map(row.values.map((value) => [value.column, value.value])),
  }));
}

function nativeRowSource(
  snapshot: VisualizationSnapshot,
  preview: ReportAiPreviewSummary | null,
): {
  rows: NativeRow[];
  preview: ReportAiPreviewSummary | null;
  snapshotRows: NativeRow[];
} {
  const snapshotRows = alignedRows(snapshot);
  const hasTransformedValues =
    snapshot.display.rollingWindow !== null ||
    snapshot.display.cumulative ||
    snapshot.display.stack === "percent";
  if (hasTransformedValues || preview === null || snapshot.temporal !== null) {
    return { rows: snapshotRows, preview: null, snapshotRows };
  }
  return { rows: previewRows(preview), preview, snapshotRows };
}

function previewOverflowNotice(
  preview: ReportAiPreviewSummary | null,
  rows: NativeRow[],
  snapshotRows: NativeRow[],
  snapshot: VisualizationSnapshot,
): string | null {
  if (preview === null) {
    return null;
  }
  if (preview.rowsReturned > rows.length) {
    return "_…additional rows omitted from the stored preview_";
  }
  if (preview.rowsReturned !== 0 || preview.visualizationRows.length > 0) {
    return null;
  }
  if (snapshotRows.length > rows.length) {
    return "_…additional rows omitted from the stored preview_";
  }
  const hasNamedSeries = snapshot.series.some((series) => {
    const separator = series.id.lastIndexOf(":");
    return separator !== -1 && series.id.slice(0, separator) !== "All";
  });
  return hasNamedSeries && snapshotRows.length < rows.length
    ? "_…additional rows may be omitted from the stored visualization_"
    : null;
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
    return previewMetricColumns(preview).map((column) => {
      const value = formatPreviewValue(
        column,
        requireRowValue(row, column.key),
      );
      return `${escapeMarkdown(column.label)}: ${escapeMarkdown(value)}`;
    });
  }
  return snapshot.series.map(
    (series) =>
      `${escapeMarkdown(series.label)}: ${formatNativeSeriesValue(snapshot, series, row)}`,
  );
}

function escapeMarkdown(value: string): string {
  return escapeDiscordMarkdown(value.replaceAll(/[\r\n]+/g, " ")).replaceAll(
    /[()[\]<>]/g,
    (char) => `\\${char}`,
  );
}

function escapeTableCell(value: string): string {
  return value
    .replaceAll(/`{3,}/g, (ticks) => "′".repeat(ticks.length))
    .replaceAll(/[\r\n]+/g, " ");
}
