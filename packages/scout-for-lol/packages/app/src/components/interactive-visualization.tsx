import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  VisualizationSnapshotSchema,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { visualizationSnapshotToOption } from "@scout-for-lol/report/visualization";

/**
 * `compact` and `heightPx` are two ways to ask for the same thing, kept apart
 * on purpose: `compact` is the established preset, while `heightPx` exists for
 * the expanded view, where the right height is "as much of the dialog as there
 * is" and no preset can know that. The ResizeObserver below means either one
 * simply works.
 */
export function InteractiveVisualization(props: {
  snapshot: VisualizationSnapshot;
  compact?: boolean;
  onPointClick?: (
    label: string,
    value: number | null,
    seriesName: string,
  ) => void;
  heightPx?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const snapshotRef = useRef(props.snapshot);
  const onPointClickRef = useRef(props.onPointClick);
  onPointClickRef.current = props.onPointClick;

  // Init once: canvas + ResizeObserver + dispose. Re-initialising per
  // snapshot rebuilt every on-screen chart from scratch each time a turn's
  // refetch produced fresh message objects — a visible flicker right when a
  // new answer lands.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const clickHandler = (params: echarts.ECElementEvent) => {
      if (params.componentType === "series") {
        const details = visualizationPointClickDetails(
          snapshotRef.current,
          params,
        );
        if (details.label !== "") {
          onPointClickRef.current?.(
            details.label,
            details.value,
            details.seriesName,
          );
        }
      }
    };
    chart.on("click", clickHandler);

    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container);
    return () => {
      chart.off("click", clickHandler);
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Apply options per snapshot. `notMerge` replaces the previous option
  // outright — the old dispose+init had replace semantics, and a merge would
  // keep stale series when a new snapshot has fewer. The Zod parse stays: it
  // is the wire-data guard, and it runs once per distinct snapshot, not per
  // streamed token.
  useEffect(() => {
    const snapshot = VisualizationSnapshotSchema.parse(props.snapshot);
    snapshotRef.current = snapshot;
    chartRef.current?.setOption(
      visualizationSnapshotToOption(snapshot, "interactive"),
      { notMerge: true },
    );
  }, [props.snapshot]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-md border border-border"
      style={{ height: props.heightPx ?? (props.compact === true ? 180 : 480) }}
      role="img"
      aria-label={props.snapshot.title ?? "Interactive Scout visualization"}
    />
  );
}

export function visualizationPointClickDetails(
  snapshot: VisualizationSnapshot,
  params: Pick<
    echarts.ECElementEvent,
    "data" | "name" | "seriesName" | "value"
  >,
): { label: string; value: number | null; seriesName: string } {
  const namedLabel = params.name.trim();
  if (namedLabel !== "") {
    return pointClickDetails(namedLabel, params);
  }

  if (typeof params.data === "string") {
    return pointClickDetails(params.data, params);
  }

  const tuple = Array.isArray(params.data) ? params.data : null;
  if (tuple === null) return emptyPointClickDetails(params.seriesName);

  if (snapshot.kind === "HEATMAP") {
    return heatmapPointClickDetails(snapshot, tuple, params.seriesName);
  }

  if (snapshot.kind === "CALENDAR_HEATMAP") {
    return calendarPointClickDetails(snapshot, tuple, params.seriesName);
  }

  return emptyPointClickDetails(params.seriesName);
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function pointClickDetails(
  label: string,
  params: Pick<echarts.ECElementEvent, "seriesName" | "value">,
): { label: string; value: number | null; seriesName: string } {
  return {
    label,
    value: numericValue(params.value),
    seriesName: params.seriesName ?? "",
  };
}

function heatmapPointClickDetails(
  snapshot: VisualizationSnapshot,
  tuple: unknown[],
  seriesName: string | undefined,
): { label: string; value: number | null; seriesName: string } {
  const xIndex = tuple[0];
  const yIndex = tuple[1];
  if (typeof xIndex !== "number" || typeof yIndex !== "number") {
    return emptyPointClickDetails(seriesName);
  }
  const series = snapshot.series[xIndex];
  const yLabels = [
    ...new Set(
      snapshot.series.flatMap((item) =>
        item.points.map((point) => point.label),
      ),
    ),
  ];
  const pointLabel = yLabels[yIndex];
  if (series === undefined || pointLabel === undefined) {
    return emptyPointClickDetails(seriesName);
  }
  const point = series.points.find((item) => item.label === pointLabel);
  return {
    label: `${series.label}: ${pointLabel}`,
    value: numericValue(tuple[2]) ?? point?.value ?? null,
    seriesName: fallbackSeriesName(seriesName, series.label),
  };
}

function calendarPointClickDetails(
  snapshot: VisualizationSnapshot,
  tuple: unknown[],
  seriesName: string | undefined,
): { label: string; value: number | null; seriesName: string } {
  const date = tuple[0];
  if (typeof date !== "string") return emptyPointClickDetails(seriesName);
  const point = snapshot.series
    .flatMap((series) => series.points)
    .find((item) => item.label === date);
  return {
    label: point?.label ?? date,
    value: numericValue(tuple[1]) ?? point?.value ?? null,
    seriesName: fallbackSeriesName(seriesName, snapshot.series[0]?.label ?? ""),
  };
}

function fallbackSeriesName(
  seriesName: string | undefined,
  fallback: string,
): string {
  return seriesName === undefined || seriesName === "" ? fallback : seriesName;
}

function emptyPointClickDetails(seriesName: string | undefined): {
  label: string;
  value: number | null;
  seriesName: string;
} {
  return { label: "", value: null, seriesName: seriesName ?? "" };
}
