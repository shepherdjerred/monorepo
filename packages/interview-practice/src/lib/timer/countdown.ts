import { z } from "zod/v4";
import type { TimerPhase, TimerState } from "./schemas.ts";

const WarningKeySchema = z.enum(["50%", "75%", "5min"]);

export type Timer = {
  getElapsedMs: () => number;
  getRemainingMs: () => number;
  getPhase: () => TimerPhase;
  getDisplayTime: () => string;
  checkWarnings: () => string[];
  getState: () => TimerState;
  resume: (state: TimerState) => void;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
}

export function createTimer(durationMinutes: number): Timer {
  const durationMs = durationMinutes * 60 * 1000;
  let startedAt = Date.now();
  let baseElapsedMs = 0;
  const warningsEmitted = new Set<string>();

  function getElapsedMs(): number {
    return baseElapsedMs + (Date.now() - startedAt);
  }

  function getRemainingMs(): number {
    return Math.max(0, durationMs - getElapsedMs());
  }

  function getPhase(): TimerPhase {
    const elapsed = getElapsedMs();
    const remaining = durationMs - elapsed;

    if (elapsed >= durationMs) return "overtime";
    if (remaining <= 5 * 60 * 1000) return "last_5min";
    if (elapsed >= durationMs * 0.75) return "past_75";
    if (elapsed >= durationMs * 0.5) return "past_50";
    return "first_half";
  }

  function getDisplayTime(): string {
    const remaining = getRemainingMs();
    if (remaining <= 0) return "OVERTIME +" + formatMs(getElapsedMs() - durationMs);
    return formatMs(remaining) + " remaining";
  }

  function checkWarnings(): string[] {
    const warnings: string[] = [];
    const elapsed = getElapsedMs();

    if (elapsed >= durationMs * 0.5 && !warningsEmitted.has("50%")) {
      warningsEmitted.add("50%");
      warnings.push("We're about halfway through.");
    }
    if (elapsed >= durationMs * 0.75 && !warningsEmitted.has("75%")) {
      warningsEmitted.add("75%");
      warnings.push("About 25% of time remaining.");
    }
    if (
      durationMs - elapsed <= 5 * 60 * 1000 &&
      elapsed < durationMs &&
      !warningsEmitted.has("5min")
    ) {
      warningsEmitted.add("5min");
      warnings.push("5 minutes remaining.");
    }

    return warnings;
  }

  function getState(): TimerState {
    return {
      durationMs,
      elapsedMs: getElapsedMs(),
      warningsEmitted: [...warningsEmitted]
        .map((w) => WarningKeySchema.safeParse(w))
        .filter((r) => r.success)
        .map((r) => r.data),
      lastCheckpointMs: Date.now(),
    };
  }

  function resume(state: TimerState): void {
    baseElapsedMs = state.elapsedMs;
    startedAt = Date.now();
    for (const w of state.warningsEmitted) {
      warningsEmitted.add(w);
    }
  }

  return {
    getElapsedMs,
    getRemainingMs,
    getPhase,
    getDisplayTime,
    checkWarnings,
    getState,
    resume,
  };
}
