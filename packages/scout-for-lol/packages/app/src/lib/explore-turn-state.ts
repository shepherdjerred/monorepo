import {
  ExploreTraceEntrySchema,
  type ExploreMessage,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";

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
  /** Null only while the start mutation is still creating the server run. */
  runId: string | null;
  /** Null until `started` arrives for a brand-new conversation. */
  conversationId: string | null;
  /** From the `started` event; null until it arrives. */
  questionMessageId: string | null;
  /** Optimistic question text; null for a regenerate. */
  question: string | null;
  /** Streamed prose so far; replaced by the final message's content. */
  answer: string | null;
  activity: string | null;
  /** Provider-id-keyed steps, updated in place as their results arrive. */
  trace: ExploreTraceEntry[];
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
    runId: null,
    conversationId: input.conversationId,
    questionMessageId: null,
    question: input.question,
    answer: null,
    activity: "Thinking…",
    trace: [],
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
    case "snapshot": {
      return {
        ...turn,
        runId: event.runId,
        conversationId: event.conversationId,
        questionMessageId: event.questionMessageId,
        leafIdAtStart: event.leafIdAtStart,
        answer: event.answer,
        activity: event.activity,
        trace: event.trace,
      };
    }
    case "started": {
      return {
        ...turn,
        runId: event.runId,
        conversationId: event.conversationId,
        questionMessageId: event.questionMessageId,
      };
    }
    case "tool_call": {
      return {
        ...turn,
        activity: event.message,
        trace: applyTraceEvent(turn.trace, event),
      };
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
        trace: event.message.trace,
      };
    }
    case "preview":
    case "error":
    case "done": {
      return turn;
    }
    case "tool_result": {
      return {
        ...turn,
        activity: event.message,
        trace: applyTraceEvent(turn.trace, event),
      };
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
    trace: interruptRunningTrace(turn.trace),
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
  trace: ExploreTraceEntry[];
} {
  if (turn === null) {
    return {
      pendingQuestion: null,
      pendingAnswer: null,
      activity: null,
      trace: [],
    };
  }
  if (turn.conversationId !== displayedConversationId) {
    return {
      pendingQuestion: null,
      pendingAnswer: null,
      activity: null,
      trace: [],
    };
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
    trace: landed ? [] : turn.trace,
  };
}

function applyTraceEvent(
  trace: ExploreTraceEntry[],
  event: Extract<ExploreStreamEvent, { type: "tool_call" | "tool_result" }>,
): ExploreTraceEntry[] {
  if (event.type === "tool_call") {
    return [
      ...trace,
      ExploreTraceEntrySchema.parse({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        message: event.message,
        status: "running",
        durationMs: null,
        details: event.details,
        rawInput: event.rawInput,
        rawOutput: null,
      }),
    ];
  }
  const index = trace.findIndex(
    (entry) => entry.toolCallId === event.toolCallId,
  );
  const current = index === -1 ? null : trace[index];
  const completed = ExploreTraceEntrySchema.parse({
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    message: event.message,
    status: event.status,
    durationMs: event.durationMs,
    details: event.details,
    rawInput: current?.rawInput ?? null,
    rawOutput: event.rawOutput,
  });
  if (index === -1) {
    return [...trace, completed];
  }
  return trace.map((entry, entryIndex) =>
    entryIndex === index ? completed : entry,
  );
}

function interruptRunningTrace(
  trace: ExploreTraceEntry[],
): ExploreTraceEntry[] {
  return trace.map((entry) =>
    entry.status === "running"
      ? ExploreTraceEntrySchema.parse({
          ...entry,
          status: "interrupted",
          message: "Interrupted before this step finished.",
        })
      : entry,
  );
}
