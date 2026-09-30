/**
 * Record ids retired from the competitive-progression catalog by a rename
 * whose replacement measures something different (e.g. "largest_multikill"
 * -> "pentakills": multikill size vs. pentakill count).
 *
 * Every persisted path that validates a Hall record id against the current
 * catalog schema (guild settings, queued break-outbox payloads) must drop
 * exactly these ids rather than relabel them, and must keep failing loudly on
 * any other unrecognized id — that would be corrupt data, not a known rename.
 */
export const RETIRED_HALL_RECORD_IDS: ReadonlySet<string> = new Set([
  "largest_multikill",
]);
