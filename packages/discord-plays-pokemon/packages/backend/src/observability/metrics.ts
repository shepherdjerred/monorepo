// Pokémon-specific Prometheus instruments, registered against the shared registry
// from discord-plays-core. The shared registry + the emu/stream instruments both
// backends define identically (registry, emulateMs, lateMs, ticksTotal,
// loopResyncTotal, sinkBufferBytes, streamActive, FRAME_MS_BUCKETS) live in
// `@shepherdjerred/discord-plays-core/observability/metrics.ts`; import those
// directly from core. This file holds the game events / notification / save-load
// instruments plus copyMs (whose help text differs from mario-kart's).
import { Histogram, Counter, Gauge } from "prom-client";
import {
  registry,
  FRAME_MS_BUCKETS,
} from "@shepherdjerred/discord-plays-core/observability/metrics.ts";

export const copyMs = new Histogram({
  name: "emulator_frame_copy_ms",
  help: "Time to render the frame and hand it to the stream, in ms",
  buckets: FRAME_MS_BUCKETS,
  registers: [registry],
});

export const frameHookErrorsTotal = new Counter({
  name: "emulator_frame_hook_errors_total",
  help: "Exceptions thrown by frame hooks (isolated from the frame loop)",
  registers: [registry],
});

export const gameEventsTotal = new Counter({
  name: "game_events_total",
  help: "In-game events detected by the memory watcher, by kind",
  labelNames: ["kind"],
  registers: [registry],
});

export const snapshotInvalidTotal = new Counter({
  name: "game_snapshot_invalid_total",
  help: "Polls where the game state was unreadable (no save loaded, torn read)",
  registers: [registry],
});

export const flashSaveLoadInvalidTotal = new Counter({
  name: "flash_save_load_invalid_total",
  help: "Boots where the on-disk flash save existed but was the wrong size (corrupt / torn / format change) and was ignored",
  registers: [registry],
});

export const notificationSendErrorsTotal = new Counter({
  name: "notification_send_errors_total",
  help: "Failures sending game event notifications to Discord",
  registers: [registry],
});

export const goalActive = new Gauge({
  name: "pokemon_goal_active",
  help: "Whether a Pokemon goal Codex process is currently active",
  registers: [registry],
});

export const goalRunsTotal = new Counter({
  name: "pokemon_goal_runs_total",
  help: "Terminal Pokemon goal runs by process-lifecycle status",
  labelNames: ["status"],
  registers: [registry],
});

export const goalDurationSeconds = new Histogram({
  name: "pokemon_goal_duration_seconds",
  help: "Pokemon goal process runtime by process-lifecycle status",
  labelNames: ["status"],
  buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800],
  registers: [registry],
});

export const goalToolCallsTotal = new Counter({
  name: "pokemon_goal_tool_calls_total",
  help: "Goal control-server tool calls by route and HTTP status (unknown routes collapse to 'other')",
  labelNames: ["path", "status"],
  registers: [registry],
});

export const goalTokensTotal = new Counter({
  name: "pokemon_goal_tokens_total",
  help: "Codex tokens consumed by terminal goal runs, by kind",
  labelNames: ["kind"],
  registers: [registry],
});

export const goalCostUsdTotal = new Counter({
  name: "pokemon_goal_cost_usd_total",
  help: "Estimated USD cost of terminal goal runs",
  registers: [registry],
});

export const goalProgressUpdatesTotal = new Counter({
  name: "pokemon_goal_progress_updates_total",
  help: "Audience-facing goal updates posted to Discord, by source (agent /progress, forwarded milestone, interval floor)",
  labelNames: ["source"],
  registers: [registry],
});
