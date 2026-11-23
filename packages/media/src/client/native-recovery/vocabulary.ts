import { z } from "zod";

/**
 * The states the server writes onto a native recovery plan, of every kind:
 * `preparing` when it is created, `awaiting_review` when its checks finish,
 * `applying` when the owner approves, and `applied` when the work completes.
 * The column is free text, so another state is an answer this page cannot
 * read; a test keeps this list equal to what the server code writes.
 */
export const NATIVE_REVIEW_STATES = [
  "preparing",
  "awaiting_review",
  "applying",
  "applied",
] as const;
const NativeReviewStateSchema = z.enum(NATIVE_REVIEW_STATES);
type NativeReviewState = z.infer<typeof NativeReviewStateSchema>;

/** What a review's state means for the owner. */
export const REVIEW_STATE = {
  preparing: {
    label: "Being prepared",
    tone: "neutral",
    meaning:
      "Workers are inspecting the files, storage, and Plex identity. Nothing is changed, and this page updates itself.",
  },
  awaiting_review: {
    label: "Needs your approval",
    tone: "warn",
    meaning:
      "Nothing has changed. Check what follows, then approve or leave it.",
  },
  applying: {
    label: "Approval queued",
    tone: "neutral",
    meaning:
      "Current content and authority are checked again before anything changes.",
  },
  applied: {
    label: "Applied",
    tone: "ok",
    meaning: "The approved change is recorded.",
  },
} satisfies Record<
  NativeReviewState,
  { label: string; tone: "neutral" | "ok" | "warn"; meaning: string }
>;

/** A state the server sent, or an error when it is not one the server writes. */
export function reviewState(state: string): NativeReviewState {
  return NativeReviewStateSchema.parse(state);
}

/** A code the server gives for a state or a reason, as a sentence-case phrase. */
export function phrase(code: string): string {
  const words = code.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function when(value: string): string {
  return new Date(value).toLocaleString();
}

/** The titles a file covers, named once each, in the order the review lists them. */
export function coveredTitles(
  media: readonly { id: string; title: string }[],
  mediaIds: readonly string[],
): string {
  return media
    .filter((item) => mediaIds.includes(item.id))
    .map((item) => item.title)
    .join(", ");
}
