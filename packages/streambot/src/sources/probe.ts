/**
 * Best-effort `ffprobe` of a resolved source so its media properties (video/audio codec, resolution,
 * HDR, channels) are visible at runtime. There was no probing before this — during the 2026-06-07
 * stutter incident the source being a 2160p HEVC 10-bit remux with a lossless TrueHD track was
 * completely invisible. This never throws and never blocks playback: a probe failure logs a warning
 * and returns `null`.
 */

import { z } from "zod";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("probe");

/** Hard cap so probing a slow/remote input can never wedge the resolve step. */
const PROBE_TIMEOUT_MS = 15_000;

const StreamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  pix_fmt: z.string().optional(),
  color_transfer: z.string().optional(),
  channels: z.number().optional(),
});

const FfprobeOutputSchema = z.object({
  streams: z.array(StreamSchema).default([]),
  format: z.object({ duration: z.string().optional() }).optional(),
});

export type MediaInfo = {
  videoCodec: string;
  width: number | undefined;
  height: number | undefined;
  pixelFormat: string | undefined;
  hdr: boolean;
  audioCodec: string;
  audioChannels: number | undefined;
  durationSeconds: number | undefined;
};

/** Map a pixel height to a coarse, bounded resolution label (keeps `streambot_source_info` low-card). */
export function resolutionBucket(height?: number): string {
  if (height === undefined) return "unknown";
  if (height >= 2000) return "2160p";
  if (height >= 1400) return "1440p";
  if (height >= 1000) return "1080p";
  if (height >= 600) return "720p";
  return "sd";
}

/** ffprobe `color_transfer` values that denote HDR (PQ / HLG). */
export function isHdrTransfer(transfer?: string): boolean {
  return transfer === "smpte2084" || transfer === "arib-std-b67";
}

/** Parse ffprobe's `-show_streams -show_format` JSON into a {@link MediaInfo}; null if it doesn't validate. */
export function parseFfprobeOutput(json: unknown): MediaInfo | null {
  const parsed = FfprobeOutputSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const video = parsed.data.streams.find((s) => s.codec_type === "video");
  const audio = parsed.data.streams.find((s) => s.codec_type === "audio");
  const rawDuration = parsed.data.format?.duration;
  const durationSeconds =
    rawDuration === undefined ? undefined : Number(rawDuration);
  return {
    videoCodec: video?.codec_name ?? "unknown",
    width: video?.width,
    height: video?.height,
    pixelFormat: video?.pix_fmt,
    hdr: isHdrTransfer(video?.color_transfer),
    audioCodec: audio?.codec_name ?? "unknown",
    audioChannels: audio?.channels,
    durationSeconds:
      durationSeconds !== undefined && Number.isFinite(durationSeconds)
        ? durationSeconds
        : undefined,
  };
}

/**
 * Run ffprobe on `input` and return parsed media info, or null on any failure (missing binary,
 * non-zero exit, timeout, unparseable output, abort). Honors `signal` and an internal timeout.
 */
export async function probeMedia(
  config: Config,
  input: string,
  signal?: AbortSignal,
): Promise<MediaInfo | null> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const abort =
    signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  try {
    const proc = Bun.spawn(
      [
        config.ffprobePath,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        input,
      ],
      { stdout: "pipe", stderr: "pipe", signal: abort },
    );
    // Drain stdout AND stderr concurrently. If stderr were only read on failure, a chatty ffprobe
    // could fill the (~64 KB) pipe buffer and block before closing stdout, hanging the stdout read.
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      log.warn("ffprobe exited non-zero", { exitCode, stderr: stderr.trim() });
      return null;
    }
    return parseFfprobeOutput(JSON.parse(stdout));
  } catch (error) {
    log.warn("ffprobe failed", { error: getErrorMessage(error) });
    return null;
  }
}
