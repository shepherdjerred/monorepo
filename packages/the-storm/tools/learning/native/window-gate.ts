import type { z } from "zod";
import type { DuelState } from "#learning/duels.ts";
import type { InferenceMetrics } from "#learning/inference.ts";
import type { DuelFrameReceipt } from "#client/duel-video.ts";
import type { DuelClockReceipt } from "#client/duel-clock.ts";
import { verifyDuelOutcome } from "#client/duel-recording.ts";
import clockWire from "#client-duel-clock-wire";

function verifyTimingActor(
  state: DuelState,
  metrics: z.infer<typeof InferenceMetrics>,
) {
  if (
    state.result !== "timeout" ||
    state.mode !== "external" ||
    state.opponent !== "stationary" ||
    state.dealt !== 0 ||
    state.received !== 0 ||
    state.applied < 600 ||
    metrics.delivery.applied !== state.applied ||
    metrics.delivery.unavailable + metrics.delivery.ineligible !==
      state.fallback
  )
    throw new Error(
      "Native timing diagnostic lacks a full live window and later undamaged timeout",
    );
}

/** A full native live prefix and a separate, later timeout from the fixed timing actor. */
export function verifyLiveWindow(
  frames: DuelFrameReceipt,
  clock: z.infer<typeof DuelClockReceipt>,
  state: DuelState,
  metrics: z.infer<typeof InferenceMetrics>,
) {
  verifyDuelOutcome(frames, clock, state);
  verifyTimingActor(state, metrics);
  const first = frames.duel.clock.entries[1]?.marker;
  const last = frames.duel.clock.entries.at(-1)?.marker;
  const terminal = clock.entries.at(-1)?.marker;
  if (
    frames.duel.terminalFrame !== -1 ||
    frames.duel.clock.complete ||
    first?.elapsed !== 0 ||
    last?.elapsed !== 599 ||
    last.marker !== "tick" ||
    terminal?.elapsed !== clockWire.maximumElapsed ||
    new Set(frames.frames.map((frame) => frame.sha256)).size < 2
  )
    throw new Error(
      "Native timing diagnostic lacks a full live window and later undamaged timeout",
    );
  return {
    firstLiveElapsed: first.elapsed,
    lastLiveElapsed: last.elapsed,
    terminalElapsed: terminal.elapsed,
    renderedFrames: frames.frames.length,
    heldFrames: 0,
  };
}
