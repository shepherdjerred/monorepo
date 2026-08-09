import type { VisualizationSnapshot } from "@scout-for-lol/data";
import {
  ANALYTICS_BODY_FONT,
  ANALYTICS_CHART_HEIGHT,
  ANALYTICS_CHART_WIDTH,
  ANALYTICS_FONT_FILE_PATHS,
} from "#src/html/analytics-chart-theme.ts";
import {
  echartsOptionToSvg,
  echartsSvgToImage,
} from "#src/html/echarts-image.ts";
import { visualizationSnapshotToOption } from "#src/html/visualization-snapshot-option.ts";

export function visualizationSnapshotToSvg(
  snapshot: VisualizationSnapshot,
): string {
  return echartsOptionToSvg(
    visualizationSnapshotToOption(snapshot, "static"),
    ANALYTICS_CHART_WIDTH,
    ANALYTICS_CHART_HEIGHT,
  );
}

export function visualizationSnapshotToImage(
  snapshot: VisualizationSnapshot,
): Buffer {
  return echartsSvgToImage(
    visualizationSnapshotToSvg(snapshot),
    ANALYTICS_FONT_FILE_PATHS,
    ANALYTICS_BODY_FONT,
  );
}
