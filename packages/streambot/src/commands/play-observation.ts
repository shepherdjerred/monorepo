import { BlockedSourceError } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  playRequestsTotal,
  type TelemetryOutcome,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import { usageAnalytics } from "@shepherdjerred/streambot/observability/product-analytics.ts";
import { currentSelectionKind } from "@shepherdjerred/streambot/observability/usage-context.ts";
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

/** Counts and records one play request for its entry-point surface, whatever way it ends. */
export async function observePlay<T>(
  input: Pick<PlayInput, "surface" | "signal" | "userId" | "placement">,
  run: () => Promise<T>,
  options: { readonly batch?: boolean } = {},
): Promise<T> {
  const surface = input.surface ?? "other";
  const record = (outcome: TelemetryOutcome) => {
    playRequestsTotal.inc({ surface, outcome });
    const selectionKind = currentSelectionKind();
    usageAnalytics().capture(input.userId, {
      event: "streambot_play_requested",
      properties: {
        surface,
        outcome,
        placement: input.placement,
        batch: options.batch === true,
        ...(surface === "web" && selectionKind !== undefined
          ? { selection_kind: selectionKind }
          : {}),
      },
    });
  };
  try {
    const result = await run();
    record("ok");
    return result;
  } catch (error) {
    record(failureOutcome(error, input.signal));
    throw error;
  }
}
