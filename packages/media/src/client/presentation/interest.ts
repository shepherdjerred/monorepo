import type { z } from "zod";
import type { LibraryInterestSchema } from "#shared/household/library.ts";

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
