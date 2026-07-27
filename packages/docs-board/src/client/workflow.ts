import type { DocumentStatus } from "#shared/schema";

export const COLUMN_LABELS: Record<DocumentStatus, string> = {
  planned: "Planned",
  "in-progress": "In Progress",
  "awaiting-human": "Awaiting User Acceptance",
  complete: "Complete",
};

export const COLUMN_HINTS: Record<DocumentStatus, string> = {
  planned: "Queued, blocked, or deferred",
  "in-progress": "Active agent work",
  "awaiting-human": "Behavior ready for acceptance",
  complete: "Verified and done",
};
