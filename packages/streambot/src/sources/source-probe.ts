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
    audio === undefined
      ? primary
      : {
          ...primary,
          audioCodec: audio.audioCodec,
          audioChannels: audio.audioChannels,
          audioStreamIndex: audio.audioStreamIndex ?? 0,
        };
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
  return await probeAndRecordSourceMetadata(
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
}
