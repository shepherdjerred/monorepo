import type { z } from "zod";
import type { RemovalHistoryItemSchema } from "#shared/household/calendar.ts";
import type { Copy } from "./copy.ts";

type Removal = z.infer<typeof RemovalHistoryItemSchema>;

/** Where a removal ended up. */
export const REMOVAL_STATE_COPY = {
  quarantined: { label: "Removed, can be restored", tone: "warn" },
  purged: { label: "Removed for good", tone: "danger" },
  restored: { label: "Restored", tone: "ok" },
  cancelled: { label: "Removal called off", tone: "neutral" },
} as const satisfies Record<Removal["state"], Copy>;

/** Why a title left, as one sentence. */
export const REMOVAL_REASON_COPY = {
  owner_removed: "The library owner removed it.",
  temporary_interest_released:
    "Nobody was following it any more, and it was not being kept for good.",
  watched_by_requesters: "Everyone who asked for it had watched it.",
} as const satisfies Record<Removal["reason"], string>;

/**
 * What can still be done about a removal, where the row does not already say
 * so: a restorable one shows its deadline and a restored one its state.
 */
export const RESTORE_COPY = {
  recoverable: null,
  restored: null,
  reacquire: "The files are gone. Asking for it again starts a new search.",
  unavailable: "Open the title to see what can still be done.",
} as const satisfies Record<Removal["restoreState"], string | null>;

/** What a removed thing is, for the line under its name. */
export const REMOVED_KIND_COPY = {
  movie: "Film",
  series: "Series",
  season: "Season",
  episode: "Episode",
} as const satisfies Record<Removal["kind"], string>;

/** The phases of a removal that has not happened yet or can be undone. */
export const REMOVAL_PHASES = [
  "warning_pending",
  "grace_period",
  "quarantined",
] as const;
export type RemovalPhase = (typeof REMOVAL_PHASES)[number];

/**
 * `GET /api/v1/removals` types a row's state as a string; these are the
 * states it lists. A row in any other state is a contract this client does
 * not know, so it fails here instead of being shown under a guessed label.
 */
export function removalPhase(state: string): RemovalPhase {
  const phase = REMOVAL_PHASES.find((candidate) => candidate === state);
  if (phase === undefined) {
    throw new Error(`Unknown removal state "${state}"`);
  }
  return phase;
}
