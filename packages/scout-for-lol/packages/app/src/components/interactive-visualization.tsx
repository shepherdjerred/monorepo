import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  VisualizationSnapshotSchema,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { visualizationSnapshotToOption } from "@scout-for-lol/report/visualization";

export function InteractiveVisualization(props: {
  snapshot: VisualizationSnapshot;
  compact?: boolean;
  onPointClick?: (
    label: string,
    value: number | null,
    seriesName: string,
  ) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
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
        const label =
          params.name || (typeof params.data === "string" ? params.data : "");
        const value = typeof params.value === "number" ? params.value : null;
        onPointClickRef.current?.(label, value, params.seriesName ?? "");
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
    chartRef.current?.setOption(
      visualizationSnapshotToOption(
        VisualizationSnapshotSchema.parse(props.snapshot),
        "interactive",
      ),
      { notMerge: true },
    );
  }, [props.snapshot]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-md border border-border"
      style={{ height: props.compact === true ? 180 : 480 }}
      role="img"
      aria-label={props.snapshot.title ?? "Interactive Scout visualization"}
    />
  );
}
