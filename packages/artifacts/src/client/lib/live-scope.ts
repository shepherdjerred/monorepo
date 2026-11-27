import type { LiveMessage } from "@shepherdjerred/artifacts/contract";

/** What a live message makes stale: one agent connecting touches only the header. */
export type Staleness = "all" | "waiters";

/** The query key prefixes (`keys.waiters`, `keys.pending`) the waiter header reads. */
export const WAITER_QUERY_PREFIXES = ["waiters", "pending"] as const;

export function stalenessOf(message: LiveMessage): Staleness {
  return message.type === "change" && message.kind === "waiter"
    ? "waiters"
    : "all";
}

/** Folds a burst into one refetch: any message that needs everything wins. */
export function widen(current: Staleness | null, next: Staleness): Staleness {
  return current === "all" || next === "all" ? "all" : next;
}
