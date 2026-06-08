import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { probeFileChapters } from "@shepherdjerred/streambot/sources/chapters.ts";
import { resolveWithYtdlp } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import { resolveSubtitleForFile } from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import {
  BlockedSourceError,
  isBlockedSource,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  probeMedia,
  resolutionBucket,
} from "@shepherdjerred/streambot/sources/probe.ts";
import { setSourceInfo } from "@shepherdjerred/streambot/observability/metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("resolve");

/**
 * Probe the resolved input and publish its media properties as a log line + the
 * `streambot_source_info` metric. Best-effort — {@link probeMedia} never throws, and a null result
 * (probe failed) simply skips the update.
 */
async function recordSourceMetadata(
  config: Config,
  resolved: ResolvedSource,
  signal: AbortSignal,
): Promise<void> {
  const info = await probeMedia(config, resolved.ffmpegInput, signal);
  if (info === null) {
    return;
  }
  const resolution = resolutionBucket(info.height);
  log.info("source probed", {
    title: resolved.title,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    width: info.width,
    height: info.height,
    resolution,
    hdr: info.hdr,
    pixelFormat: info.pixelFormat,
    audioChannels: info.audioChannels,
    durationSeconds: info.durationSeconds,
  });
  setSourceInfo({
    video_codec: info.videoCodec,
    audio_codec: info.audioCodec,
    hdr: info.hdr ? "true" : "false",
    resolution,
  });
}

/**
 * Resolve a {@link Source} to a {@link ResolvedSource} ffmpeg can read: local files pass straight
 * through, URL/search sources go through the system yt-dlp. Adult sources are rejected here — once
 * up front on the obvious request, and again on the yt-dlp-resolved domain (inside
 * {@link resolveWithYtdlp}) for searches/redirects. This is the machine's `resolveSource` actor.
 */
export async function resolveSource(
  config: Config,
  source: Source,
  signal: AbortSignal,
): Promise<ResolvedSource> {
  if (isBlockedSource(source)) {
    throw new BlockedSourceError(sourceLabel(source));
  }
  let resolved: ResolvedSource;
  if (source.kind === "file") {
    const subtitle = await resolveSubtitleForFile(
      config,
      source.path,
      source.subtitles,
      signal,
    );
    resolved = {
      title: source.title,
      ffmpegInput: source.path,
      chapters: await probeFileChapters(config, source.path, signal),
      ...(subtitle === undefined ? {} : { subtitle }),
    };
  } else {
    resolved = await resolveWithYtdlp(config, source, signal);
  }
  await recordSourceMetadata(config, resolved, signal);
  return resolved;
}
