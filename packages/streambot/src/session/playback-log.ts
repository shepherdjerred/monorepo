import { createTransitionLogInspector } from "@shepherdjerred/discord-stream-lifecycle/debug/transition-logger";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/**
 * Scalar-only projection of the playback machine's context for machine-transition log lines.
 * Receives the context as `unknown` (untyped at the XState inspection boundary) and reads only
 * primitive fields — never live objects like `resolved`/`voice`, which may be large or hold streams.
 */
function projectPlaybackContext(context: unknown): Record<string, unknown> {
  if (typeof context !== "object" || context === null) return {};
  const projected: Record<string, unknown> = {};
  if ("loop" in context && typeof context.loop === "string") {
    projected["loop"] = context.loop;
  }
  if ("volume" in context && typeof context.volume === "number") {
    projected["volume"] = context.volume;
  }
  if ("queue" in context && Array.isArray(context.queue)) {
    projected["queueLength"] = context.queue.length;
  }
  if ("lastErrorKind" in context && typeof context.lastErrorKind === "string") {
    projected["lastErrorKind"] = context.lastErrorKind;
  }
  return projected;
}

/**
 * XState `inspect` observer that logs every playback-machine state transition (including transient
 * `always` states) under the `machine` log module, scoped to one session by `label` (guild:channel).
 */
export function createPlaybackInspector(label: string) {
  return createTransitionLogInspector({
    log: logger.child("machine"),
    label,
    projectContext: projectPlaybackContext,
  });
}
