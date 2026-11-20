import { BlockedSourceError } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  playRequestsTotal,
  type TelemetryOutcome,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { PlaybackCommandBoundaryError } from "./playback-command-errors.ts";
import type { PlayInput } from "./playback-input.ts";

function failureOutcome(
  error: unknown,
  signal: AbortSignal | undefined,
): TelemetryOutcome {
  if (
    error instanceof PlaybackCommandBoundaryError ||
    error instanceof BlockedSourceError
  )
    return "denied";
  return signal?.aborted === true ? "aborted" : "error";
}

/** Counts one play request for its entry-point surface, whatever way it ends. */
export async function observePlay<T>(
  input: Pick<PlayInput, "surface" | "signal">,
  run: () => Promise<T>,
): Promise<T> {
  const surface = input.surface ?? "other";
  try {
    const result = await run();
    playRequestsTotal.inc({ surface, outcome: "ok" });
    return result;
  } catch (error) {
    playRequestsTotal.inc({
      surface,
      outcome: failureOutcome(error, input.signal),
    });
    throw error;
  }
}
