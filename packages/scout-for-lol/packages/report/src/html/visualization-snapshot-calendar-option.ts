import { evidenceGames, type VisualizationSnapshot } from "@scout-for-lol/data";
import type * as echarts from "echarts";
import { calendarTooltipText } from "#src/html/visualization-calendar-tooltip.ts";
import {
  VISUALIZATION_BODY_FONT,
  visualizationSnapshotBaseOption,
  visualizationSnapshotPresentation,
} from "#src/html/visualization-snapshot-style.ts";

export function calendarOption(
  snapshot: VisualizationSnapshot,
  _mode?: "interactive" | "static",
): echarts.EChartsOption {
  const points = snapshot.series[0]?.points ?? [];
  const values = points.flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  const presentation = visualizationSnapshotPresentation(snapshot);
  return {
    ...visualizationSnapshotBaseOption(snapshot, "Scout calendar"),
    tooltip: { formatter: (input) => calendarTooltipText(snapshot, input) },
    visualMap: {
      min: Math.min(...values, 0),
      max: Math.max(...values, 1),
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 18,
      textStyle: {
        color: presentation.theme.muted,
        fontFamily: VISUALIZATION_BODY_FONT,
      },
      inRange: { color: presentation.colors },
    },
    calendar: {
      top: 90,
      left: 48,
      right: 36,
      bottom: 78,
      range:
        points.length === 0
          ? emptyCalendarRange(snapshot)
          : [points[0]?.label ?? "", points.at(-1)?.label ?? ""],
      itemStyle: {
        color: presentation.theme.panel,
        borderColor: presentation.theme.border,
        borderWidth: 3,
      },
      dayLabel: {
        color: presentation.theme.muted,
        fontFamily: VISUALIZATION_BODY_FONT,
      },
      monthLabel: {
        color: presentation.theme.text,
        fontFamily: VISUALIZATION_BODY_FONT,
      },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: points.flatMap((point) =>
          point.value === null
            ? []
            : [
                [
                  point.label,
                  point.value,
                  point.comparisonValue ?? null,
                  point.absoluteDelta ?? null,
                  point.percentageDelta ?? null,
                  evidenceGames(point.evidence),
                ],
              ],
        ),
      },
    ],
  };
}

function emptyCalendarRange(
  snapshot: VisualizationSnapshot,
): string | [string, string] {
  const temporal = snapshot.temporal;
  if (temporal?.window.kind === "calendar") {
    return [temporal.window.startDate, temporal.window.endDate];
  }
  const generatedAt = new Date(snapshot.generatedAt);
  if (temporal?.window.kind === "relative") {
    return [
      calendarDateInTimezone(
        new Date(generatedAt.getTime() - temporal.window.days * 86_400_000),
        temporal.timezone,
      ),
      calendarDateInTimezone(generatedAt, temporal.timezone),
    ];
  }
  return generatedAt.getUTCFullYear().toString();
}

function calendarDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not format calendar range in ${timezone}.`);
  }
  return `${year}-${month}-${day}`;
}
