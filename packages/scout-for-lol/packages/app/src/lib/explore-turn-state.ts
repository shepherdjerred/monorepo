import type { ExploreMessage, ExploreStreamEvent } from "@scout-for-lol/data";

/**
 * Pure state for one in-flight explore turn.
 *
 * Everything the page needs to render a streaming turn — and to decide when
 * the persisted transcript has caught up with it — lives here as plain data
 * and pure functions, so the tricky decisions (which conversation the stream
 * belongs to, when the optimistic copies disappear) are testable without a
 * DOM. The hook that drives the network holds one of these and applies the
 * reducers; it decides nothing itself.
 */
export type ExplorePendingTurn = {
  /** Null until `started` arrives for a brand-new conversation. */
  conversationId: string | null;
  /** From the `started` event; null until it arrives. */
  questionMessageId: string | null;
  /** Optimistic question text; null for a regenerate. */
  question: string | null;
  /** Streamed prose so far; replaced by the final message's content. */
  answer: string | null;
  activity: string | null;
  /**
   * The on-screen leaf id when the turn began — how a stop tells a fresh
   * salvage row apart from the answer that was already there.
   */
  leafIdAtStart: string | null;
  /** The persisted answer's id once `final` arrives. */
  finalMessageId: string | null;
  phase: "streaming" | "stopping";
};

export function createPendingTurn(input: {
  conversationId: string | null;
  question: string | null;
  leafIdAtStart: string | null;
}): ExplorePendingTurn {
  return {
    conversationId: input.conversationId,
    questionMessageId: null,
    question: input.question,
    answer: null,
    activity: "Thinking…",
    leafIdAtStart: input.leafIdAtStart,
    finalMessageId: null,
    phase: "streaming",
  };
}

/**
 * Fold one stream event into the turn.
 *
 * `final` replaces the streamed prose with the persisted message's content —
 * the two can differ by whatever the last delta had not delivered yet, and
 * the persisted text is what the refetch will show. `error` is deliberately
 * not folded here: an error message is page state (it outlives the turn), so
 * the hook handles it.
 */
export function applyStreamEvent(
  turn: ExplorePendingTurn,
  event: ExploreStreamEvent,
): ExplorePendingTurn {
  switch (event.type) {
    case "started": {
      return {
        ...turn,
        conversationId: event.conversationId,
        questionMessageId: event.questionMessageId,
      };
    }
    case "tool_call": {
      return { ...turn, activity: event.message };
    }
    case "answer_delta": {
      return { ...turn, answer: (turn.answer ?? "") + event.text };
    }
    case "final": {
      return {
        ...turn,
        answer: event.message.content,
        finalMessageId: event.message.id,
        activity: null,
      };
    }
    case "preview":
    case "tool_result":
    case "error":
    case "done": {
      return turn;
    }
  }
}

/** Mark a deliberate stop while the salvage catch-up runs. */
export function markStopping(turn: ExplorePendingTurn): ExplorePendingTurn {
  return {
    ...turn,
    phase: "stopping",
    activity:
      turn.answer === null ? null : "Stopped — saving the partial answer…",
  };
}

/**
 * Has the persisted transcript caught up with this turn?
 *
 * True once the refetched messages contain the `final` message, or — for a
 * stop, which never gets a `final` — once the path ends in a fresh assistant
 * answer under this turn's question. `leafIdAtStart` excludes the answer that
 * was already on screen when a regenerate began; a persisted question with no
 * answer under it is deliberately not enough.
 */
export function turnHasLanded(
  turn: ExplorePendingTurn,
  messages: ExploreMessage[],
): boolean {
  if (
    turn.finalMessageId !== null &&
    messages.some((message) => message.id === turn.finalMessageId)
  ) {
    return true;
  }
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    turn.questionMessageId !== null &&
    last.parentId === turn.questionMessageId &&
    last.id !== turn.leafIdAtStart
  );
}

/**
 * What the transcript should render for this turn, given which conversation
 * is on screen and what the persisted transcript already contains.
 *
 * All-null when the turn belongs to a different conversation — that is the
 * whole fix for a stream bleeding into whichever conversation the user
 * switched to. A null turn-conversation matches only the not-yet-created
 * view (`displayedConversationId === null`), so a first turn renders while
 * `started` is still in flight.
 *
 * The optimistic question disappears the moment the fetched messages contain
 * it (the duplicate-first-question fix), and the streamed answer disappears
 * once the turn has landed — so there is never a frame showing both copies,
 * and never a frame showing neither.
 */
export function visiblePending(
  turn: ExplorePendingTurn | null,
  displayedConversationId: string | null,
  messages: ExploreMessage[],
): {
  pendingQuestion: string | null;
  pendingAnswer: string | null;
  activity: string | null;
} {
  if (turn === null) {
    return { pendingQuestion: null, pendingAnswer: null, activity: null };
  }
  if (turn.conversationId !== displayedConversationId) {
    return { pendingQuestion: null, pendingAnswer: null, activity: null };
  }
  const questionPersisted =
    turn.questionMessageId !== null &&
    messages.some((message) => message.id === turn.questionMessageId);
  const landed = turnHasLanded(turn, messages);
  return {
    pendingQuestion: questionPersisted ? null : turn.question,
    pendingAnswer: landed ? null : turn.answer,
    activity: landed ? null : turn.activity,
  };
}
