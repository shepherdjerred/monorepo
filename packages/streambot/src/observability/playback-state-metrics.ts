import { Gauge } from "prom-client";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";

const playbackStateGauge = new Gauge({
  name: "streambot_playback_state",
  help: "Number of playback actors in each finite machine state (idle 1 when none are active)",
  labelNames: ["state"] as const,
  registers: [register],
});

/** Aggregate bounded machine-state labels across concurrently active playback actors. */
export function setPlaybackStates(states: readonly string[]): void {
  playbackStateGauge.reset();
  if (states.length === 0) {
    playbackStateGauge.set({ state: "idle" }, 1);
    return;
  }
  const counts = new Map<string, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  for (const [state, count] of counts) playbackStateGauge.set({ state }, count);
}
