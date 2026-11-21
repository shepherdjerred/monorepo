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

type InterestAction = z.infer<typeof RequestInterestCommandSchema>["action"];

/**
 * What each interest command's button says. "Keep watching" is the name the
 * reminder emails use for it, so it keeps that name here.
 */
export const INTEREST_ACTION_COPY = {
  continue: "Keep watching",
  finished: "I have finished it",
  drop: "Stop following",
  keep: "Keep for good",
  temporary: "Keep just for now",
  notice_viewed: "I have seen this reminder",
} as const satisfies Record<InterestAction, string>;
