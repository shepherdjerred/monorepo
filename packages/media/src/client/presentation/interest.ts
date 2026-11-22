import type { z } from "zod";
import type {
  InterestStateSchema,
  KeepingPolicySchema,
  RequestInterestCommandSchema,
} from "#shared/household/interests.ts";
import type { LibraryInterestSchema } from "#shared/household/library.ts";
import type { Copy } from "./copy.ts";

/**
 * The reader's own tie to a library title. `none` has no words: a title the
 * reader never asked for says nothing about them.
 */
export const LIBRARY_INTEREST_COPY = {
  following: "You follow this",
  released: "You no longer follow this",
  none: null,
} as const satisfies Record<
  z.infer<typeof LibraryInterestSchema>,
  string | null
>;

/** Where a person's interest in something they asked for stands. */
export const INTEREST_STATE_COPY = {
  following: { label: "Following", tone: "ok" },
  finished: { label: "Finished", tone: "neutral" },
  dropped: { label: "Stopped following", tone: "neutral" },
  expired: { label: "Stopped after no answer", tone: "neutral" },
} as const satisfies Record<z.infer<typeof InterestStateSchema>, Copy>;

/** How long a request asks for its title to be kept. */
export const REQUEST_KEEPING_COPY = {
  keep: "Kept for good",
  temporary: "Just for now, while you follow it",
} as const satisfies Record<z.infer<typeof KeepingPolicySchema>, string>;

// What each interest command's button says is in
// `shared/household/names.ts` (`INTEREST_ACTION_NAMES`), not here: the
// reminder emails name those buttons, so client and server share one table.

/**
 * What a command changed, said back in the words of the button that sent
 * it, where the thing it was about stays on screen afterwards.
 */
export const INTEREST_DONE_COPY = {
  continue: "You are still watching this.",
  finished: "You have finished this.",
  drop: "You have stopped following this.",
  keep: "This is now kept for good.",
  temporary: "This is now kept just for now.",
  notice_viewed: "You have seen this reminder.",
} as const satisfies Record<
  z.infer<typeof RequestInterestCommandSchema>["action"],
  string
>;
