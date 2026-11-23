import type { z } from "zod";
import type { SubtitleReplacementDetailSchema } from "#shared/subtitle-replacement.ts";

type Detail = z.infer<typeof SubtitleReplacementDetailSchema>;
type Tone = "neutral" | "ok" | "warn" | "danger";

/** Where a replacement stands, and what that means for what the owner can do. */
export const REPLACEMENT_STATE = {
  preparing: {
    label: "Being prepared",
    tone: "neutral",
    meaning:
      "Media is checking the video, the installed subtitle, and the replacement bytes. No file has been replaced.",
  },
  awaiting_review: {
    label: "Needs your approval",
    tone: "warn",
    meaning:
      "No file has been replaced. Check the details below, then approve the replacement or leave it.",
  },
  applying: {
    label: "Being replaced",
    tone: "neutral",
    meaning:
      "Your approval is queued. Current ownership and file identity are checked again before the replacement.",
  },
  reconciling: {
    label: "Being reconciled",
    tone: "neutral",
    meaning:
      "Media is checking the effects it recorded for this operation. Nothing else changes until that finishes.",
  },
  applied: {
    label: "Replaced",
    tone: "ok",
    meaning:
      "The replacement is installed. The earlier file is kept for a while for recovery only. This page does not offer undo.",
  },
  rolled_back: {
    label: "Rolled back",
    tone: "warn",
    meaning:
      "The interrupted replacement was compensated. The previous subtitle was restored.",
  },
  protected: {
    label: "Protected",
    tone: "danger",
    meaning:
      "Media stopped this operation because a safety check did not pass. The reason is shown below.",
  },
  abandoned: {
    label: "Ended without a replacement",
    tone: "neutral",
    meaning:
      "This review ended without replacing anything. Prepare a new review to try again.",
  },
} satisfies Record<
  Detail["state"],
  { label: string; tone: Tone; meaning: string }
>;

export const SUBTITLE_QUALITY = {
  accepted: "Accepted",
  unverified: "Not yet verified",
  rejected: "Rejected",
} satisfies Record<Detail["oldQuality"], string>;

export function forcedLabel(value: boolean | null): string {
  if (value === null) return "Forced status unknown";
  return value ? "Forced dialogue only" : "Full subtitles";
}

export function hearingLabel(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Included" : "Not included";
}

/** A code the server gives for a reason or a state, as a sentence-case phrase. */
export function phrase(code: string): string {
  const words = code.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
