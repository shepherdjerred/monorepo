import { contributeGauge } from "@shepherdjerred/discord-plays-core/observability/gauge-contribution.ts";
import {
  streamAvContentOffsetMs,
  streamFfmpegBitrateKbps,
  streamFfmpegFps,
  streamFfmpegSpeedRatio,
  streamHwEncodeEngaged,
  streamTrackerVideoSourceDepth,
} from "#src/observability/metrics.ts";

export function createStreamMetrics() {
  const gauges = {
    speedRatio: contributeGauge(streamFfmpegSpeedRatio, "min"),
    fps: contributeGauge(streamFfmpegFps, "sum"),
    bitrate: contributeGauge(streamFfmpegBitrateKbps, "sum"),
    hardware: contributeGauge(streamHwEncodeEngaged, "sum"),
    avOffset: contributeGauge(streamAvContentOffsetMs, "max-absolute"),
    sourceDepth: contributeGauge(streamTrackerVideoSourceDepth, "sum"),
  };
  return {
    ...gauges,
    close() {
      for (const gauge of Object.values(gauges)) gauge.close();
    },
  };
}

export type StreamMetrics = ReturnType<typeof createStreamMetrics>;
