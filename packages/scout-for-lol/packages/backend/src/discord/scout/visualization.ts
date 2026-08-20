import { AttachmentBuilder, Colors, EmbedBuilder } from "discord.js";
import {
  REPORT_METRICS,
  type ExploreMessage,
  type TemporalSeries,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { visualizationSnapshotToImage } from "@scout-for-lol/report";

const NATIVE_KINDS = new Set(["TABLE", "LIST", "LEADERBOARD", "KPI_CARD"]);
const MAX_NATIVE_ROWS = 12;
const MAX_EMBED_DESCRIPTION = 3900;

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
    const embed = visualizationToEmbed(snapshot);
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
): EmbedBuilder | null {
  const description = nativeDescription(snapshot);
  if (description === null) {
    return null;
  }
  const embed = new EmbedBuilder()
    .setColor(Colors.DarkGold)
    .setDescription(description);
  if (snapshot.title !== null) {
    embed.setTitle(snapshot.title);
  }
  return embed;
}

function nativeDescription(snapshot: VisualizationSnapshot): string | null {
  if (snapshot.series.length === 0) {
    return null;
  }
  if (snapshot.kind === "KPI_CARD") {
    return formatKpi(snapshot);
  }
  if (snapshot.kind === "LEADERBOARD") {
    return formatLeaderboard(snapshot);
  }
  return formatTable(snapshot);
}

function formatKpi(snapshot: VisualizationSnapshot): string {
  return snapshot.series
    .map((series) => {
      const point = series.points[0];
      const value = formatSeriesValue(snapshot, series, point?.value ?? null);
      return `**${escapeMarkdown(series.label)}**\n${value}`;
    })
    .join("\n\n");
}

function formatLeaderboard(snapshot: VisualizationSnapshot): string {
  const allRows = alignedRows(snapshot);
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const lines = rows.map((row, index) => {
    const values = snapshot.series
      .map((series) =>
        formatSeriesValue(snapshot, series, row.values.get(series.id) ?? null),
      )
      .join(" · ");
    return `**${(index + 1).toString()}.** ${escapeMarkdown(row.label)} — ${values}`;
  });
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more_`);
  }
  return lines.join("\n");
}

function formatTable(snapshot: VisualizationSnapshot): string {
  const allRows = alignedRows(snapshot);
  const rows = allRows.slice(0, MAX_NATIVE_ROWS);
  const extra = allRows.length - rows.length;
  const headers = ["", ...snapshot.series.map((series) => series.label)];
  const lines = [
    `| ${headers.map((header) => escapeTableCell(header)).join(" | ")} |`,
    `| ${headers.map((_, index) => (index === 0 ? "---" : "---:")).join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${[
          escapeTableCell(row.label),
          ...snapshot.series.map((series) =>
            escapeTableCell(
              formatSeriesValue(
                snapshot,
                series,
                row.values.get(series.id) ?? null,
              ),
            ),
          ),
        ].join(" | ")} |`,
    ),
  ];
  if (extra > 0) {
    lines.push(`_…and ${extra.toString()} more rows_`);
  }
  const text = lines.join("\n");
  if (text.length <= MAX_EMBED_DESCRIPTION) {
    return text;
  }
  return `${lines.slice(0, 4).join("\n")}\n_Table truncated to fit Discord._`;
}

function alignedRows(snapshot: VisualizationSnapshot): {
  label: string;
  values: Map<string, number | null>;
}[] {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const values = new Map<string, Map<string, number | null>>();
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
  return order.map((key) => ({
    label: labels.get(key) ?? key,
    values: values.get(key) ?? new Map(),
  }));
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

function escapeMarkdown(value: string): string {
  return value.replaceAll(/[\\_*`|]/g, (char) => `\\${char}`);
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}
