import type { z } from "zod";
import type { LibraryPageSchema } from "#shared/household/library.ts";

type LibraryItem = z.infer<typeof LibraryPageSchema>["items"][number];

/** How long the library keeps a title. */
export const KEEPING_COPY = {
  keep: "Kept for good",
  temporary: "Just for now",
  unclassified: "Not decided yet",
} as const satisfies Record<LibraryItem["policy"], string>;

/** Why a title is still in the library, as one sentence. */
export const PROTECTION_COPY = {
  keep_indefinitely: "Stays in the library for good.",
  temporary_interest: "Stays while someone is following it.",
  review_required: "Stays until the owner decides how long to keep it.",
} as const satisfies Record<LibraryItem["protection"], string>;

/** What the owner's button does to a title the library keeps this way. */
export const KEEPING_CHANGE_COPY = {
  keep: { action: "Keep just for now", next: "temporary" },
  temporary: { action: "Keep for good", next: "keep" },
} as const satisfies Record<
  NonNullable<LibraryItem["libraryKeeping"]>["keepingPolicy"],
  { action: string; next: "keep" | "temporary" }
>;
