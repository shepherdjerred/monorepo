import { streamCrashesTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import type { PipelineMode } from "@shepherdjerred/streambot/machine/types.ts";
import type { StallInfo } from "@shepherdjerred/streambot/streamer/stream-errors.ts";

export type StallReport = {
  readonly pipelineMode: PipelineMode;
  readonly transport: string;
  readonly lastMediaSeconds: number | undefined;
  readonly reason: string;
  /** Media offset the current ffmpeg invocation started at, kept current across live seeks. */
  readonly offsetSeconds: number;
};

/**
 * Turn a detected stall into the crash counter and the resume position a listener acts on.
 *
 * A stall IS a mid-stream segment death, so it is counted alongside crash and ended-short —
 * otherwise aborting the actor leaves the segment outcome at "ended" and the recovery goes
 * uncounted, which makes the `stall` kind on that counter permanently empty.
 *
 * The resume position comes from the producer's last DELIVERED media time, not from the wall-clock
 * position tracker: that tracker over-counts when ffmpeg was producing below realtime before it
 * froze, and resuming from an over-counted position skips media nobody saw. With no media time
 * parsed yet the segment start is the only honest answer — and it is all the send-side detector can
 * offer anyway, since in that case ffmpeg was producing fine and the transport was the problem.
 */
export function buildStallReport(report: StallReport): StallInfo {
  streamCrashesTotal.inc({
    transport: report.transport,
    pipeline: report.pipelineMode,
    kind: "stall",
  });
  const positionSeconds =
    report.lastMediaSeconds === undefined
      ? report.offsetSeconds
      : report.offsetSeconds + report.lastMediaSeconds;
  return { positionSeconds, reason: report.reason };
}
