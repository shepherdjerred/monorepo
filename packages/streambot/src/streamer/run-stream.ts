import { rm } from "node:fs/promises";
import type {
  RunStreamInput,
  PipelineMode,
  ResolvedSubtitle,
} from "@shepherdjerred/streambot/machine/types.ts";
import { StreamCrashError } from "@shepherdjerred/streambot/streamer/stream-errors.ts";
import { hwFallbackTotal } from "@shepherdjerred/streambot/observability/metrics.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
const log = logger.child("streamer");
export async function runStreamWithFallback(
  input: RunStreamInput,
  signal: AbortSignal,
  options: {
    hardwareAcceleration: boolean;
    lastPosition: () => number;
    streamOnce: (
      input: RunStreamInput,
      signal: AbortSignal,
      mode: PipelineMode,
      position: number,
    ) => Promise<void>;
  },
): Promise<void> {
  // Subtitles no longer disqualify VAAPI: prepareStream composes them as a GPU overlay branch
  // (libass alpha canvas → hwupload → overlay_vaapi), so decode, scale, tonemap, and encode all
  // stay on the GPU even with burned-in subs. The startup fallback below remains the safety net
  // for graph features the device lacks (tonemap_vaapi/overlay_vaapi on older iGPUs).
  // `PipelineMode` is a *video encoder* ladder — hw → hw-upload → sw. A music segment has no
  // encoder at all, so it is pinned to "sw" here rather than inside streamOnce: doing it here is
  // what stops the startup-failure branch below from announcing a pointless "retrying in
  // software" attempt for a song, which would reach users through CrashNotice and operators
  // through streamCrashesTotal{pipeline}.
  const pipelineMode: PipelineMode =
    input.resolved.mediaKind === "music" || !options.hardwareAcceleration
      ? "sw"
      : input.pipelineMode;
  try {
    try {
      // Start at the resume offset (0 for a fresh play; >0 when resuming after a restart).
      await options.streamOnce(input, signal, pipelineMode, input.seekSeconds);
    } catch (error) {
      // Mid-stream deaths (crash / ended-short) carry position + pipeline context; the playback
      // machine owns that recovery ladder (bounded retry at position, hw → hw-upload → sw).
      if (error instanceof StreamCrashError) throw error;
      if (pipelineMode !== "sw" && !signal.aborted) {
        // Startup failure on a hardware pipeline (device/driver/graph init): retry immediately
        // in software, resuming at wherever playback (incl. any live seek) had reached.
        const resumeAt = options.lastPosition();
        hwFallbackTotal.inc();
        log.warn("hardware (VAAPI) encode failed; retrying with software", {
          error: getErrorMessage(error),
          resumeAt,
        });
        await options.streamOnce(input, signal, "sw", resumeAt);
        return;
      }
      throw error;
    }
  } finally {
    // Drop the staged subtitle temp file once the whole track is done (covers both encode attempts
    // and every in-segment seek, which reuse the same file).
    await cleanupSubtitle(input.resolved.subtitle);
  }
}

async function cleanupSubtitle(
  subtitle: ResolvedSubtitle | undefined,
): Promise<void> {
  // No cleanupPath → a persistent subtitle-cache entry shared across plays; never unlink it.
  if (subtitle?.cleanupPath === undefined) return;
  try {
    await rm(subtitle.cleanupPath, { force: true });
  } catch (error) {
    log.warn("failed to remove subtitle temp file", {
      path: subtitle.cleanupPath,
      error: getErrorMessage(error),
    });
  }
}
