import { contributeGauge } from "@shepherdjerred/discord-plays-core/observability/gauge-contribution.ts";
import { runtimeGauge } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import {
  streamAvContentOffsetMs,
  streamFfmpegBitrateKbps,
  streamFfmpegFps,
  streamFfmpegSpeedRatio,
  streamHwEncodeEngaged,
  streamTrackerVideoSourceDepth,
} from "#src/observability/metrics.ts";

export function createStreamMetrics(runtime = "mk64") {
  const gauges = {
    speedRatio: contributeGauge(
      runtimeGauge(streamFfmpegSpeedRatio, runtime),
      "min",
    ),
    fps: contributeGauge(runtimeGauge(streamFfmpegFps, runtime), "sum"),
    bitrate: contributeGauge(
      runtimeGauge(streamFfmpegBitrateKbps, runtime),
      "sum",
    ),
    hardware: contributeGauge(
      runtimeGauge(streamHwEncodeEngaged, runtime),
      "sum",
    ),
    avOffset: contributeGauge(
      runtimeGauge(streamAvContentOffsetMs, runtime),
      "max-absolute",
    ),
    sourceDepth: contributeGauge(
      runtimeGauge(streamTrackerVideoSourceDepth, runtime),
      "sum",
    ),
  };
  return {
    runtime,
    ...gauges,
    close() {
      for (const gauge of Object.values(gauges)) gauge.close();
    },
  };
}

export type StreamMetrics = ReturnType<typeof createStreamMetrics>;
