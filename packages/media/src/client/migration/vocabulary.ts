import type { z } from "zod";
import type {
  MigrationProposalSchema,
  MigrationReportEntrySchema,
  SourceKindSchema,
} from "#shared/migration.ts";

type Tone = "neutral" | "ok" | "warn" | "danger";
type Copy = { label: string; tone: Tone };

export const SOURCE_LABELS = {
  radarr: "Radarr",
  sonarr: "Sonarr",
  overseerr: "Overseerr",
  jellyseerr: "Jellyseerr",
  seerr: "Seerr",
  bazarr: "Bazarr",
  qbittorrent: "qBittorrent",
} satisfies Record<z.infer<typeof SourceKindSchema>, string>;

type Status = z.infer<typeof MigrationProposalSchema>["status"];

/** A review's status, and what it means for the next step. */
export const REVIEW_STATUS = {
  protected: {
    label: "Protected",
    tone: "danger",
    meaning:
      "The capture is incomplete, or its source was changing while it was read, so it cannot be approved. Capture the source again.",
  },
  awaiting_review: {
    label: "Needs your review",
    tone: "warn",
    meaning: "Nothing is saved until you review the evidence and approve it.",
  },
  approved: {
    label: "Approved",
    tone: "ok",
    meaning: "You approved this. You can revoke the approval.",
  },
  revoked: {
    label: "Revoked",
    tone: "neutral",
    meaning: "You revoked your approval. It no longer counts as reviewed.",
  },
} satisfies Record<Status, Copy & { meaning: string }>;

type Entry = z.infer<typeof MigrationReportEntrySchema>;

export const RECORD_KINDS = {
  media: "Title",
  file: "File",
  request: "Request",
  subtitle_preference: "Subtitle preference",
  subtitle: "Subtitle",
  torrent: "Torrent",
} satisfies Record<Entry["kind"], string>;

export const CONFIDENCE = {
  exact: { label: "Exact match", tone: "ok" },
  ambiguous: { label: "Ambiguous match", tone: "warn" },
  unknown: { label: "No match", tone: "neutral" },
} satisfies Record<Entry["confidence"], Copy>;

export const ENTRY_STATE = {
  protected: { label: "Protected", tone: "warn" },
  protected_exact: { label: "Protected, exact match", tone: "warn" },
  adoptable_evidence_ready: { label: "Evidence ready", tone: "ok" },
} satisfies Record<Entry["state"], Copy>;

/** A reason code the capture gives, as a sentence-case phrase. */
export function reasonLabel(code: string): string {
  const phrase = code.replaceAll("_", " ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function when(value: string): string {
  return new Date(value).toLocaleString();
}
