import type {
  ResolvedSource,
  RunStreamInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { PrepareSportsInput } from "@shepherdjerred/streambot/sports/prepared-input.ts";
import { SportsPlaybackError } from "@shepherdjerred/streambot/sports/failures.ts";
import { StreamCrashError } from "@shepherdjerred/streambot/streamer/stream-errors.ts";

function providerFailure(error: unknown, input: RunStreamInput): unknown {
  if (
    !(error instanceof SportsPlaybackError) ||
    (error.kind !== "session-expired" &&
      error.kind !== "unavailable" &&
      error.kind !== "timeout")
  )
    return error;
  return new StreamCrashError(error.message, {
    kind: "provider-session",
    positionSeconds: 0,
    pipelineMode: input.pipelineMode,
    exitCode: null,
    stderrTail: [],
  });
}

export function concreteMediaInput(source: ResolvedSource): string {
  if (source.ffmpegInput === undefined)
    throw new Error("Deferred sports input must be prepared before streaming");
  return source.ffmpegInput;
}

/** Own private media resources for exactly one invoked playback attempt. */
export async function runWithPreparedSportsInput(
  input: RunStreamInput,
  signal: AbortSignal,
  prepare: PrepareSportsInput | undefined,
  run: (input: RunStreamInput, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  signal.throwIfAborted();
  if (!("sportsRecipe" in input.resolved)) {
    await run(input, signal);
    return;
  }
  if (prepare === undefined)
    throw new Error("Sports input preparation is not configured");
  const prepared = await prepare(input.resolved.sportsRecipe, signal).catch(
    (error: unknown) => {
      throw providerFailure(error, input);
    },
  );
  const playback = new AbortController();
  let running: Promise<void> | undefined;
  try {
    signal.throwIfAborted();
    const {
      sportsRecipe: _recipe,
      ffmpegVideoStreamIndex: _videoIndex,
      ffmpegAudioStreamIndex: _audioIndex,
      ...metadata
    } = input.resolved;
    running = run(
      {
        ...input,
        resolved: {
          ...metadata,
          ffmpegInput: prepared.input,
          ffmpegInputHeaders: prepared.headers,
          ...(prepared.inputOptions === undefined
            ? {}
            : { ffmpegInputOptions: prepared.inputOptions }),
          ...(prepared.audioInput === undefined
            ? {}
            : { audioInput: prepared.audioInput }),
          ...(prepared.audioInputHeaders === undefined
            ? {}
            : { audioInputHeaders: prepared.audioInputHeaders }),
          ...(prepared.audioInputOptions === undefined
            ? {}
            : { audioInputOptions: prepared.audioInputOptions }),
          ...(prepared.videoStreamIndex === undefined
            ? {}
            : { ffmpegVideoStreamIndex: prepared.videoStreamIndex }),
          ...(prepared.audioStreamIndex === undefined
            ? {}
            : { ffmpegAudioStreamIndex: prepared.audioStreamIndex }),
        },
      },
      AbortSignal.any([signal, playback.signal]),
    );
    await (prepared.failure === undefined
      ? running
      : Promise.race([running, prepared.failure]));
  } catch (error) {
    signal.throwIfAborted();
    throw providerFailure(error, input);
  } finally {
    playback.abort();
    if (running !== undefined) await Promise.allSettled([running]);
    await prepared.close();
  }
}
