import type { ExploreMessage } from "@scout-for-lol/data";

/**
 * Callbacks supplied to transcript turns.
 *
 * Opt-in per callback so read-only views (like shared transcripts) pass
 * nothing while the interactive route passes handlers.
 */
export type ExploreTranscriptActions = {
  onFollowUp?: (question: string) => void;
  onEdit?: (message: ExploreMessage, question: string) => void;
  onRegenerate?: (message: ExploreMessage) => void;
  onSelectVersion?: (messageId: string) => void;
  /** Answer a question that never got one. */
  onRetry?: (question: ExploreMessage) => void;
};
