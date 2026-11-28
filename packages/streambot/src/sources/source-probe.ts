import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { ConcreteResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  probeMedia,
  resolutionBucket,
  type MediaInfo,
} from "@shepherdjerred/streambot/sources/probe.ts";
import { setSourceInfo } from "@shepherdjerred/streambot/observability/metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
const log = logger.child("resolve");

/**
 * A split source plays its audio from the companion input (`-map 1:a:N`), so every audio fact —
 * the legacy selection, its layout, and the ranked choice — has to come from that probe. The
 * primary input's own audio streams, if any, are never mapped.
 */
function withCompanionAudio(primary: MediaInfo, audio: MediaInfo): MediaInfo {
  const video = withoutPrimaryAudio(primary);
  return {
    ...video,
    audioCodec: audio.audioCodec,
    audioChannels: audio.audioChannels,
    audioStreamIndex: audio.audioStreamIndex ?? 0,
    ...(audio.audio === undefined ? {} : { audio: audio.audio }),
    ranked: {
      ...video.ranked,
      ...(audio.ranked.audioStreamIndex === undefined
        ? {}
        : { audioStreamIndex: audio.ranked.audioStreamIndex }),
      ...(audio.ranked.audio === undefined
        ? {}
        : { audio: audio.ranked.audio }),
    },
  };
}
export async function probeAndRecordSourceMetadata(
  config: Config,
  target: {
    readonly input: string;
    readonly title: string;
    readonly headers?: Readonly<Record<string, string>> | undefined;
    readonly inputOptions?: readonly string[] | undefined;
    readonly audioInput?: string | undefined;
    readonly audioInputHeaders?: Readonly<Record<string, string>> | undefined;
    readonly audioInputOptions?: readonly string[] | undefined;
  },
  signal: AbortSignal,
): Promise<MediaInfo | null> {
  const [primary, audio] = await Promise.all([
    probeMedia(config, target.input, signal, {
      headers: target.headers,
      inputOptions: target.inputOptions,
    }),
    target.audioInput === undefined
      ? Promise.resolve(undefined)
      : probeMedia(config, target.audioInput, signal, {
          headers: target.audioInputHeaders,
          inputOptions: target.audioInputOptions,
        }),
  ]);
  if (primary === null || audio === null) {
    return null;
  }
  const info =
    audio === undefined ? primary : withCompanionAudio(primary, audio);
  const resolution = resolutionBucket(info.height);
  log.info("source probed", {
    title: target.title,
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
  return info;
}

export async function probePlaybackSource(
  config: Config,
  resolved: ConcreteResolvedSource,
  signal: AbortSignal,
  sportsSource: boolean,
): Promise<MediaInfo | null> {
  const unprobedCompanion = !sportsSource && resolved.audioInput !== undefined;
  const info = await probeAndRecordSourceMetadata(
    config,
    {
      input: resolved.ffmpegInput,
      title: resolved.title,
      headers: resolved.ffmpegInputHeaders,
      inputOptions: resolved.ffmpegInputOptions,
      audioInput: sportsSource ? resolved.audioInput : undefined,
      audioInputHeaders: resolved.audioInputHeaders,
      audioInputOptions: resolved.audioInputOptions,
    },
    signal,
  );
  return info === null || !unprobedCompanion ? info : withoutPrimaryAudio(info);
}

/**
 * A yt-dlp `+` merge plays audio from its companion input, which this path does not probe. The
 * primary input's audio streams (normally none) say nothing about it, so no audio layout or
 * ranked index may be carried: `1:a:<index from input 0>` could name a stream that does not exist.
 */
function withoutPrimaryAudio(info: MediaInfo): MediaInfo {
  const {
    audio: _audio,
    ranked: {
      audioStreamIndex: _rankedIndex,
      audio: _rankedAudio,
      ...rankedVideo
    },
    ...rest
  } = info;
  return { ...rest, ranked: rankedVideo };
}
