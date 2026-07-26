import { FfmpegExitError } from "@shepherdjerred/discord-video-stream";
import type {
  CrashReason,
  PipelineMode,
} from "@shepherdjerred/streambot/machine/types.ts";

/**
 * A stream segment died mid-playback: ffmpeg crashed (non-zero exit / demuxer error) after
 * playback had started, or exited 0 far short of the probed media duration ("ended-short" — a
 * truncated network read misreported as EOF). Distinct from startup failures (which stay on the
 * streamer's own immediate software fallback) and from aborts (seek/stop/skip — never an error).
 *
 * The playback machine catches this and drives the bounded recovery ladder: re-resolve + retry at
 * {@link positionSeconds}, walking pipeline modes hw → hw-upload → sw.
 */
export class StreamCrashError extends Error {
  readonly kind: Exclude<CrashReason, "stall">;
  /** Position (seconds) playback had reached when the segment died. */
  readonly positionSeconds: number;
  /** Pipeline the dead segment ran on. */
  readonly pipelineMode: PipelineMode;
  /** ffmpeg exit code when known (0 for ended-short, null when unparseable). */
  readonly exitCode: number | null;
  /** Bounded tail of ffmpeg's stderr (empty when unavailable). */
  readonly stderrTail: readonly string[];

  constructor(
    message: string,
    opts: {
      cause?: unknown;
      kind: Exclude<CrashReason, "stall">;
      positionSeconds: number;
      pipelineMode: PipelineMode;
      exitCode: number | null;
      stderrTail: readonly string[];
    },
  ) {
    super(message, opts.cause === undefined ? {} : { cause: opts.cause });
    this.name = "StreamCrashError";
    this.kind = opts.kind;
    this.positionSeconds = opts.positionSeconds;
    this.pipelineMode = opts.pipelineMode;
    this.exitCode = opts.exitCode;
    this.stderrTail = opts.stderrTail;
  }

  /** Wrap a mid-stream failure, lifting exit code + stderr tail when the cause is ffmpeg's. */
  static fromCause(
    cause: unknown,
    ctx: { positionSeconds: number; pipelineMode: PipelineMode },
  ): StreamCrashError {
    const ffmpeg = cause instanceof FfmpegExitError ? cause : undefined;
    const message = cause instanceof Error ? cause.message : String(cause);
    return new StreamCrashError(`stream crashed mid-playback: ${message}`, {
      cause,
      kind: "crash",
      positionSeconds: ctx.positionSeconds,
      pipelineMode: ctx.pipelineMode,
      exitCode: ffmpeg?.exitCode ?? null,
      stderrTail: ffmpeg?.stderrTail ?? [],
    });
  }
}

/** A detected mid-stream stall: ffmpeg alive but silent past the watchdog threshold. */
export type StallInfo = {
  /** Playback position (seconds) when the stall was detected. */
  positionSeconds: number;
  reason: string;
};

/**
 * Classify an ffmpeg exit 0 that landed far short of the probed media duration as a truncation.
 * Tolerances: 30 s absolute AND 10% relative — either being within range means a genuine end
 * (credits cut early, container rounding, live seeks near the end).
 */
export function endedShortError(
  expectedSeconds: number | undefined,
  endedAtSeconds: number,
  pipelineMode: PipelineMode,
): StreamCrashError | null {
  if (
    expectedSeconds === undefined ||
    expectedSeconds <= 0 ||
    endedAtSeconds >= expectedSeconds - 30 ||
    endedAtSeconds >= expectedSeconds * 0.9
  ) {
    return null;
  }
  return new StreamCrashError(
    `stream ended at ${String(Math.floor(endedAtSeconds))}s of ${String(Math.floor(expectedSeconds))}s (exit 0 truncation)`,
    {
      kind: "ended-short",
      positionSeconds: endedAtSeconds,
      pipelineMode,
      exitCode: 0,
      stderrTail: [],
    },
  );
}
