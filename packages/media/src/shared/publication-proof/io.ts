import type { PublicationIntent, PublicationEntryIntent } from "./intent.ts";
import type { PublicationSubtitleLineage } from "./subtitle-lineage.ts";

/** Mechanical causal replay only. Validated versioned parents and process-local capabilities supply authority. */
export type PublicationIOIntent = Omit<
  PublicationIntent,
  "schemaVersion" | "entries"
> & {
  schemaVersion: 1 | 2;
  entries: (Pick<
    PublicationEntryIntent,
    "entryHash" | "participants" | "journals" | "subtitleEvidence"
  > & {
    entry: PublicationEntryIntent["entry"];
    originalGrant: {
      subtitleLineage?: PublicationSubtitleLineage | undefined;
    } | null;
  })[];
};
export type PublicationIOIntentRef = {
  transitionId: string;
  intentHash: string;
  intent: PublicationIOIntent;
};
