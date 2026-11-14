import type {
  ResolvedSource,
  RunStreamInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { PrepareSportsInput } from "@shepherdjerred/streambot/sports/prepared-input.ts";
import { SportsPlaybackError } from "@shepherdjerred/streambot/sports/failures.ts";
import { StreamCrashError } from "@shepherdjerred/streambot/streamer/stream-errors.ts";
import { RESOLVE_TIMEOUT_MS } from "@shepherdjerred/streambot/machine/playback-helpers.ts";
import type { PreparedSportsInput } from "@shepherdjerred/streambot/sports/prepared-input.ts";
import { preparedSportsInputFields } from "@shepherdjerred/streambot/sources/prepared-input-fields.ts";

function providerFailure(
  error: unknown,
  input: RunStreamInput,
  duringPlayback = false,
): unknown {
  if (
    !(error instanceof SportsPlaybackError) ||
    (error.kind !== "session-expired" &&
      error.kind !== "unavailable" &&
      error.kind !== "timeout" &&
      !(duringPlayback && error.kind === "unsupported-format"))
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
  const deadline = new AbortController();
  const preparationSignal = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => {
    deadline.abort(new SportsPlaybackError("timeout"));
  }, RESOLVE_TIMEOUT_MS);
  let prepared: PreparedSportsInput;
  try {
    prepared = await prepare(input.resolved.sportsRecipe, preparationSignal);
  } catch (error) {
    signal.throwIfAborted();
    throw providerFailure(
      deadline.signal.aborted ? deadline.signal.reason : error,
      input,
    );
  } finally {
    clearTimeout(timer);
  }
  const playback = new AbortController();
  let running: Promise<void> | undefined;
  try {
    preparationSignal.throwIfAborted();
    signal.throwIfAborted();
    const {
      sportsRecipe: _recipe,
      ffmpegVideoStreamIndex: _videoIndex,
      ffmpegAudioStreamIndex: _audioIndex,
      hdr: _hdr,
      ...metadata
    } = input.resolved;
    running = run(
      {
        ...input,
        resolved: {
          ...metadata,
          hdr: prepared.hdr ?? false,
          ...preparedSportsInputFields(prepared),
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
    throw providerFailure(error, input, true);
  } finally {
    playback.abort();
    if (running !== undefined) await Promise.allSettled([running]);
    await prepared.close();
  }
}
