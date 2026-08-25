import { useCallback, type RefObject } from "react";
import type { NavigateFunction } from "react-router";
import type { ExploreMessage } from "@scout-for-lol/data";
import type { ExploreRunsContextValue } from "#src/lib/explore-runs-contract.ts";
import { track } from "#src/lib/analytics.ts";
import { shouldOpenStartedExploreConversation } from "#src/lib/explore-navigation.ts";

/**
 * The four ways a turn starts — ask/follow-up, edit, regenerate, retry — all
 * funnel into `runs.startTurn`. This hook owns that funnel (and its analytics
 * `kind` labelling) so the route component stays about layout and wiring.
 */
export function useExploreTurnActions(params: {
  conversationId: string | null;
  messages: ExploreMessage[];
  runs: ExploreRunsContextValue;
  /** Kept current by the route on every render; read at submit + settle. */
  locationKeyRef: RefObject<string>;
  setRestoredDraft: (draft: string | null) => void;
  navigate: NavigateFunction;
}): {
  ask: (text: string) => void;
  handleEdit: (message: ExploreMessage, edited: string) => void;
  handleRegenerate: (message: ExploreMessage) => void;
  handleRetry: (question: ExploreMessage) => void;
} {
  const {
    conversationId,
    messages,
    runs,
    locationKeyRef,
    setRestoredDraft,
    navigate,
  } = params;

  const ask = useCallback(
    (text: string) => {
      setRestoredDraft(null);
      const submittedLocationKey = locationKeyRef.current;
      void (async () => {
        const started = await runs.startTurn({
          conversationId,
          question: text,
          attach: { kind: "leaf" },
          displayQuestion: text,
          leafIdAtStart: messages.at(-1)?.id ?? null,
        });
        if (started === null) {
          setRestoredDraft(text);
        } else {
          track("explore_turn_started", {
            kind: conversationId === null ? "new" : "follow_up",
          });
          if (
            shouldOpenStartedExploreConversation({
              submittedConversationId: conversationId,
              submittedLocationKey,
              currentLocationKey: locationKeyRef.current,
            })
          ) {
            // Replace, not push: the transient blank `/explore` should not be
            // a Back stop in the middle of a conversation.
            void navigate(`/explore/${started.conversationId}`, {
              replace: true,
            });
          }
        }
      })();
    },
    [
      conversationId,
      locationKeyRef,
      messages,
      navigate,
      runs,
      setRestoredDraft,
    ],
  );

  const handleEdit = useCallback(
    (message: ExploreMessage, edited: string) => {
      // Editing forks the question: a sibling under the same parent, or a
      // new root when the edited question *is* the root — the fork a parent
      // id cannot name, which is why `attach` exists.
      void (async () => {
        const started = await runs.startTurn({
          conversationId,
          question: edited,
          attach:
            message.parentId === null
              ? { kind: "root" }
              : { kind: "message", messageId: message.parentId },
          displayQuestion: edited,
          leafIdAtStart: messages.at(-1)?.id ?? null,
        });
        if (started !== null) track("explore_turn_started", { kind: "edit" });
      })();
    },
    [conversationId, messages, runs],
  );

  const handleRegenerate = useCallback(
    (message: ExploreMessage) => {
      // The parent of an answer is the question it belongs to.
      if (message.parentId === null) {
        return;
      }
      const parentId = message.parentId;
      void (async () => {
        const started = await runs.startTurn({
          conversationId,
          question: null,
          attach: { kind: "message", messageId: parentId },
          displayQuestion: null,
          leafIdAtStart: messages.at(-1)?.id ?? null,
        });
        if (started !== null) {
          track("explore_turn_started", { kind: "regenerate" });
        }
      })();
    },
    [conversationId, messages, runs],
  );

  // Answer a question whose turn was interrupted. Attaches to the question
  // itself rather than to a parent, because there is no answer to fork from —
  // that is the whole reason it is stranded.
  const handleRetry = useCallback(
    (question: ExploreMessage) => {
      void (async () => {
        const started = await runs.startTurn({
          conversationId,
          question: null,
          attach: { kind: "message", messageId: question.id },
          displayQuestion: null,
          leafIdAtStart: messages.at(-1)?.id ?? null,
        });
        if (started !== null) track("explore_turn_started", { kind: "retry" });
      })();
    },
    [conversationId, messages, runs],
  );

  return { ask, handleEdit, handleRegenerate, handleRetry };
}
