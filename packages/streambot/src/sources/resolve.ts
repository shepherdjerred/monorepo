import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import {
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { probeFileChapters } from "@shepherdjerred/streambot/sources/chapters.ts";
import { resolveWithYtdlp } from "@shepherdjerred/streambot/sources/ytdlp.ts";
import {
  classifyMediaKind,
  reconcileMediaKind,
  type MediaMode,
} from "@shepherdjerred/streambot/sources/media-kind.ts";
import { resolveSubtitleForFile } from "@shepherdjerred/streambot/sources/subtitle-io.ts";
import {
  BlockedSourceError,
  isBlockedSource,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  probeMedia,
  resolutionBucket,
  type MediaInfo,
} from "@shepherdjerred/streambot/sources/probe.ts";
import { setSourceInfo } from "@shepherdjerred/streambot/observability/metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("resolve");

/**
 * Probe the input ffmpeg will actually open and publish its media properties as a log line + the
 * `streambot_source_info` metric. Takes the input rather than a {@link ResolvedSource} because the
 * local-file branch below needs the probe result *before* it can construct one (`mediaKind` is
 * required, and the classifier's strongest rule is "has no video stream"). Returns the probe result
 * so the caller can thread fields the pipeline needs (HDR). Best-effort — {@link probeMedia} never
 * throws, and a null result (probe failed) simply skips the update.
 */
async function probeAndRecordSourceMetadata(
  config: Config,
  target: {
    readonly input: string;
    readonly title: string;
    readonly headers?: Readonly<Record<string, string>> | undefined;
  },
  signal: AbortSignal,
): Promise<MediaInfo | null> {
  const info = await probeMedia(config, target.input, signal, target.headers);
  if (info === null) {
    return null;
  }
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

/**
 * Re-type an item as music after the final probe found no picture in it.
 *
 * The second input has to go with it. It only ever exists because a video pass asked for a `+`
 * merge, and the music pipeline runs one input with `-vn`; leaving it set would have
 * `prepareStream` emit `-map 1:a:0` against an input the audio path never opens.
 */
function demoteToMusic(resolved: ResolvedSource): ResolvedSource {
  const {
    audioInput: _audioInput,
    audioInputHeaders: _audioInputHeaders,
    ...withoutSecondInput
  } = resolved;
  return { ...withoutSecondInput, mediaKind: "music" };
}

/**
 * A request explicitly asked for video and the input has no picture.
 *
 * Thrown rather than quietly demoted because `"video"` is only ever explicit here: a user typed
 * `mode:video`, or `streambot-music-over-voice-enabled` is off and the rollout gate forced the
 * pre-split transport. Silently playing it as music would ignore both — and in the rollout case
 * would make the flag a switch that does not switch anything off. An inferred video guess is a
 * different thing and is still demoted on the probe's evidence.
 */
export class UnsupportedVideoRequestError extends Error {
  constructor(title: string) {
    super(
      `"${title}" has no video track, so it cannot play as a video stream. Requeue it without \`mode:video\`, or ask an admin to enable music playback for this server.`,
    );
    this.name = "UnsupportedVideoRequestError";
  }
}

/**
 * Fold the final ffprobe result into a resolved source: apply rule 1's last word (see
 * {@link reconcileMediaKind}), then thread the probed HDR flag and duration.
 *
 * Exported and pure specifically so it is reachable by a unit test. `resolveSource` around it is
 * subprocess I/O — yt-dlp and ffprobe, imported directly — which no test in this package can drive,
 * and this is the assembly that decides which transport an item actually plays on. Keeping it out
 * here shrinks the untestable surface to the single call below.
 */
export function finalizeResolved(
  resolved: ResolvedSource,
  info: MediaInfo | null,
  requestedMode: MediaMode | undefined,
): ResolvedSource {
  const reconciled = reconcileMediaKind(
    resolved.mediaKind,
    // ffprobe reports `"unknown"` only when it found no video stream at all. A FAILED probe is
    // `null` and reports nothing, so it changes nothing.
    info === null ? undefined : info.videoCodec !== "unknown",
    requestedMode,
  );
  if (reconciled?.outcome === "unsupported") {
    throw new UnsupportedVideoRequestError(resolved.title);
  }
  return {
    ...(reconciled === undefined ? resolved : demoteToMusic(resolved)),
    ...(info?.hdr === true ? { hdr: true } : {}),
    ...(info?.durationSeconds === undefined
      ? {}
      : { durationSeconds: info.durationSeconds }),
  };
}

/**
 * Resolve a {@link Source} to a {@link ResolvedSource} ffmpeg can read: local files pass straight
 * through, URL/search sources go through the system yt-dlp. Adult sources are rejected here — once
 * up front on the obvious request, and again on the yt-dlp-resolved domain (inside
 * {@link resolveWithYtdlp}) for searches/redirects. This is the machine's `resolveSource` actor.
 *
 * When `preResolved` is given (from `/stream play`'s synchronous pre-validation), the expensive
 * yt-dlp/subtitle work is skipped and that result is used directly — only the cheap local probe
 * still runs, so observability (source-info metric/log) stays consistent either way.
 */
export async function resolveSource(
  config: Config,
  source: Source,
  signal: AbortSignal,
  preResolved?: ResolvedSource,
): Promise<ResolvedSource> {
  if (isBlockedSource(source)) {
    throw new BlockedSourceError(sourceLabel(source));
  }
  let resolved: ResolvedSource;
  // `undefined` means "not probed yet"; `null` means "probed and it failed". Conflating the two
  // would re-probe a local file whose probe legitimately returned nothing.
  let probed: MediaInfo | null | undefined;
  if (preResolved !== undefined) {
    resolved = preResolved;
  } else if (source.kind === "file") {
    const subtitle = await resolveSubtitleForFile(
      config,
      source.path,
      source.subtitles,
      signal,
    );
    // A local file's ffmpeg input is final before anything else resolves, so the probe that feeds
    // the source-info metric can run here — and it has to, because `mediaKind` is required at
    // construction and "the file has no video stream" is the rule that decides it.
    probed = await probeAndRecordSourceMetadata(
      config,
      { input: source.path, title: source.title },
      signal,
    );
    resolved = {
      title: source.title,
      ffmpegInput: source.path,
      // `pass: "video"` because ffprobe read the whole container, not a deliberately narrowed slice
      // of it: here "no video stream" is a real fact about the file, so rule 1 applies in full.
      mediaKind: classifyMediaKind(
        {
          mode: source.mode,
          // ffprobe reports `"unknown"` when it found no video stream at all. A failed probe leaves
          // this undefined — no evidence either way, so the library's video-only default stands.
          hasVideoStream:
            probed === null ? undefined : probed.videoCodec !== "unknown",
          provider: "local",
        },
        "video",
      ).kind,
      chapters: await probeFileChapters(config, source.path, signal),
      provenance: { provider: "local" },
      ...(subtitle === undefined ? {} : { subtitle }),
    };
  } else {
    resolved = await resolveWithYtdlp(config, source, signal);
  }
  // For yt-dlp and pre-resolved sources the ffmpeg input only becomes final once a format has been
  // chosen, so the probe runs here — on the URL the streamer will open, not on some earlier
  // candidate. (For the split-video case that is the video-only input; its audio companion is
  // yt-dlp's own pairing and is not separately probed.)
  const info =
    probed === undefined
      ? await probeAndRecordSourceMetadata(
          config,
          {
            input: resolved.ffmpegInput,
            title: resolved.title,
            headers: resolved.ffmpegInputHeaders,
          },
          signal,
        )
      : probed;
  // Rule 1's authoritative moment, plus the probed HDR flag and duration. The yt-dlp audio-first
  // pass is deliberately blind to "the selected stream has no picture" (it is true of every item
  // there), so an explicit `mode: "video"` on an audio-only source survives classification and the
  // video selector's `/bestaudio` tail lands on an audio format. This probe of the chosen input is
  // the last place that can be caught before the fork's `attachPipeline` hard-throws "No video
  // stream in media" with ffmpeg already spawned and Go Live already open.
  const finalized = finalizeResolved(resolved, info, source.mode);
  if (finalized.mediaKind !== resolved.mediaKind) {
    log.warn("media kind downgraded after probing the chosen input", {
      title: resolved.title,
      from: resolved.mediaKind,
      to: finalized.mediaKind,
      decidedBy: "no-video-stream",
    });
  }
  return finalized;
}
