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
/**
 * Whether the conversation a pending turn belongs to has left the screen.
 *
 * The two explicit callbacks that abandon a turn — picking another conversation
 * and deleting this one — cannot see every way the route changes. Browser Back
 * and Forward move it directly, and a run left going keeps holding the one
 * active run the backend allows per user, blocking the next question.
 *
 * A turn whose conversation id is still null is never abandoned here: that is a
 * brand-new conversation waiting for `started`, and the navigation that assigns
 * its id would otherwise read as having navigated away from itself.
 */
export function pendingTurnLeftTheScreen(input: {
  pendingConversationId: string | null;
  routeConversationId: string | null;
}): boolean {
  return (
    input.pendingConversationId !== null &&
    input.pendingConversationId !== input.routeConversationId
  );
}

/**
 * When to re-read the transcript after a stop, or null when there is nothing
 * to read: the conversation was never created, so no row exists to fetch.
 *
 * A stop before `started` arrives still needs one read. The server persists the
 * question before it opens the stream, so by the time a stop is possible that
 * row exists — while the copy on screen is the pending turn's optimistic one,
 * which is cleared the moment the turn ends. Skipping the read there drops the
 * question the user just asked until some unrelated refetch happens to run.
 *
 * That case needs only the one read: nothing streamed, so there is no salvage
 * write to race, and `turnHasLanded` cannot judge arrival without a question id
 * anyway. Once `started` has arrived a partial answer may still be being
 * written, so those stops keep the bounded poll (~2.1s) — a salvage slower than
 * that shows up on the next natural refetch instead.
 */
export function salvageRefreshDelays(
  turn: ExplorePendingTurn,
): { conversationId: string; delays: number[] } | null {
  if (turn.conversationId === null) {
    return null;
  }
  return {
    conversationId: turn.conversationId,
    delays: turn.questionMessageId === null ? [0] : [0, 600, 1500],
  };
}

/**
 * Has this turn's question reached the transcript, judged by position rather
 * than by id?
 *
 * The id is the obvious test and it is not sufficient: the server persists the
 * question row *before* it opens the stream, while `questionMessageId` only
 * arrives with `started`. Any refetch landing in that window returns a
 * transcript that already contains the question while the pending turn still
 * believes it has not persisted — and the reader sees their own message twice.
 *
 * So this asks the positional question instead: is there a user message saying
 * what we optimistically rendered, positioned *after* the leaf that was on
 * screen when the turn began? Anything at or before that leaf was already
 * there and is somebody else's message.
 *
 * A `leafIdAtStart` missing from the path means an edit forked away from it,
 * so the whole path belongs to this turn and the scan covers all of it. A
 * regenerate carries no question and is never matched here.
 */
function questionRowArrived(
  turn: ExplorePendingTurn,
  messages: ExploreMessage[],
): boolean {
  const question = turn.question;
  if (question === null) {
    return false;
  }
  const startIndex =
    turn.leafIdAtStart === null
      ? -1
      : messages.findIndex((message) => message.id === turn.leafIdAtStart);
  // The server trims the question before persisting it, while the composer
  // hands us the raw text, so a question typed with surrounding whitespace
  // would never match its own persisted row — and the pending copy would keep
  // rendering beside it, which is the double-question this check prevents.
  const trimmed = question.trim();
  return messages.some(
    (message, index) =>
      index > startIndex &&
      message.role === "user" &&
      message.content.trim() === trimmed,
  );
}

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
    (turn.questionMessageId !== null &&
      messages.some((message) => message.id === turn.questionMessageId)) ||
    questionRowArrived(turn, messages);
  const landed = turnHasLanded(turn, messages);
  return {
    pendingQuestion: questionPersisted ? null : turn.question,
    pendingAnswer: landed ? null : turn.answer,
    activity: landed ? null : turn.activity,
  };
}
