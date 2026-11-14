import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  ConcreteResolvedSource,
  ResolvedSource,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { MediaInfo } from "@shepherdjerred/streambot/sources/probe.ts";
import { probePlaybackSource } from "@shepherdjerred/streambot/sources/source-probe.ts";
import type {
  PrepareSportsInput,
  PreparedSportsInput,
} from "@shepherdjerred/streambot/sports/prepared-input.ts";
import type { SportsResolver } from "@shepherdjerred/streambot/sports/types.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import { preparedSportsInputFields } from "@shepherdjerred/streambot/sources/prepared-input-fields.ts";

export async function resolveSportsRequest(
  config: Config,
  source: Source,
  signal: AbortSignal,
  options:
    | {
        readonly preResolved?: ResolvedSource;
        readonly sportsResolver?: SportsResolver;
      }
    | undefined,
): Promise<ResolvedSource | undefined> {
  if (
    options?.preResolved !== undefined &&
    "sportsRecipe" in options.preResolved
  )
    return options.preResolved;
  const prepare = options?.sportsResolver?.prepare;
  return prepare === undefined ||
    source.kind !== "url" ||
    source.sportsEvent?.provider === "lolesports" ||
    sportsEventForSource(source.url) === null
    ? undefined
    : await resolvePreparedSportsSource(config, source, signal, prepare);
}
export function assertSportsHasAudioAndVideo(info: MediaInfo | null): void {
  if (
    info === null ||
    info.videoCodec === "unknown" ||
    info.audioCodec === "unknown" ||
    info.width === undefined ||
    info.width <= 0 ||
    info.height === undefined ||
    info.height <= 0 ||
    info.audioChannels === undefined ||
    info.audioChannels <= 0
  ) {
    throw new Error("The sports source did not provide both audio and video");
  }
}

function concreteSportsInput(
  prepared: PreparedSportsInput,
): ConcreteResolvedSource {
  return {
    title: prepared.title,
    ...preparedSportsInputFields(prepared),
    mediaKind: "video",
    live: true,
    chapters: [],
  };
}

/** Candidate validation runs inside the adapter's selection loop, including actual playback. */
export async function validatePreparedSportsInput(
  config: Config,
  prepared: PreparedSportsInput,
  signal: AbortSignal,
): Promise<PreparedSportsInput> {
  const info = await probePlaybackSource(
    config,
    concreteSportsInput(prepared),
    signal,
    true,
  );
  signal.throwIfAborted();
  assertSportsHasAudioAndVideo(info);
  return {
    ...prepared,
    hdr: info?.hdr ?? false,
    ...(info?.videoStreamIndex === undefined
      ? {}
      : { videoStreamIndex: info.videoStreamIndex }),
    ...(info?.audioStreamIndex === undefined
      ? {}
      : { audioStreamIndex: info.audioStreamIndex }),
  };
}

export async function resolvePreparedSportsSource(
  config: Config,
  source: Extract<Source, { kind: "url" }>,
  signal: AbortSignal,
  prepare: PrepareSportsInput,
): Promise<ResolvedSource> {
  const prepared = await prepare({ sourceUrl: source.url }, signal);
  try {
    signal.throwIfAborted();
    const concrete = concreteSportsInput(prepared);
    const info = await probePlaybackSource(config, concrete, signal, true);
    signal.throwIfAborted();
    assertSportsHasAudioAndVideo(info);
    const finalized = { ...concrete, hdr: info?.hdr ?? false };
    const {
      ffmpegInput: _input,
      ffmpegInputHeaders: _headers,
      ffmpegInputOptions: _options,
      audioInput: _audio,
      audioInputHeaders: _audioHeaders,
      audioInputOptions: _audioOptions,
      ...metadata
    } = finalized;
    return {
      ...metadata,
      sportsRecipe: { sourceUrl: source.url },
      playbackSource: source,
      provenance: { provider: "url", canonicalUrl: source.url },
    };
  } finally {
    await prepared.close();
  }
}
