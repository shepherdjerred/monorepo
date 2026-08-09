import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  VisualizationSnapshotSchema,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { visualizationSnapshotToOption } from "@scout-for-lol/report/browser";

export function InteractiveVisualization(props: {
  snapshot: VisualizationSnapshot;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const snapshot = VisualizationSnapshotSchema.parse(props.snapshot);
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chart.setOption(visualizationSnapshotToOption(snapshot, "interactive"));
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
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
