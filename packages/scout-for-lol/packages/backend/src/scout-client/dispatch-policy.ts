import type { ScoutClientObservation } from "@scout-for-lol/data";

const LIVE_COMPLETION_WINDOW_MS = 15 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Delayed outbox delivery and historical recovery must not announce old games. */
export function postGameDeliveryMode(
  observation: ScoutClientObservation,
  gameEndTimestamp: number,
  now: Date,
): "live" | "silent-backfill" | null {
  const payload = observation.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    return null;
  const resource = payload["resource"];
  if (typeof resource !== "string") return null;
  if (gameEndTimestamp > now.getTime() + FUTURE_TOLERANCE_MS) return null;
  if (/^match_history_game:\d{1,32}$/u.test(resource)) return "silent-backfill";
  if (resource !== "post_game") return null;
  return Math.min(gameEndTimestamp, Date.parse(observation.capturedAt)) <
    now.getTime() - LIVE_COMPLETION_WINDOW_MS
    ? "silent-backfill"
    : "live";
}
