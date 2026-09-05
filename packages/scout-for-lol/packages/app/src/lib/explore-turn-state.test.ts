import { describe, expect, test } from "vitest";
import {
  ExploreMessageSchema,
  ReportAiPreviewSummarySchema,
  VisualizationSnapshotSchema,
  type ExploreMessage,
} from "@scout-for-lol/data";
import {
  applyStreamEvent,
  createPendingTurn,
  exploreTurnIsActive,
  markStopping,
  turnHasLanded,
  visiblePending,
} from "#src/lib/explore-turn-state.ts";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const OTHER_CONVERSATION = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";
const OLD_ANSWER_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "66666666-6666-4666-8666-666666666666";

function message(input: {
  id: string;
  role: "user" | "assistant";
  parentId?: string | null;
  content?: string;
}): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: input.id,
    role: input.role,
    parentId: input.parentId ?? null,
    content: input.content ?? (input.role === "user" ? "Who wins?" : "Jinx."),
    createdAt: "2026-08-14T12:00:00.000Z",
  });
}

function startedTurn(question: string | null = "Who wins?") {
  return applyStreamEvent(
    createPendingTurn({
      conversationId: CONVERSATION,
      question,
      leafIdAtStart: null,
    }),
    {
      type: "started",
      runId: RUN_ID,
      conversationId: CONVERSATION,
      questionMessageId: QUESTION_ID,
    },
  );
}

describe("exploreTurnIsActive", () => {
  test("treats discovery as active before a run is restored", () => {
    expect(exploreTurnIsActive(null, false)).toBe(true);
    expect(exploreTurnIsActive(null, true)).toBe(false);
    expect(exploreTurnIsActive(startedTurn(), true)).toBe(true);
  });
});

describe("applyStreamEvent", () => {
  test("started fills the conversation and question ids", () => {
    const turn = createPendingTurn({
      conversationId: null,
      question: "Who wins?",
      leafIdAtStart: null,
    });
    const after = applyStreamEvent(turn, {
      type: "started",
      runId: RUN_ID,
      conversationId: CONVERSATION,
      questionMessageId: QUESTION_ID,
    });
    expect(after.conversationId).toBe(CONVERSATION);
    expect(after.questionMessageId).toBe(QUESTION_ID);
    expect(after.runId).toBe(RUN_ID);
  });

  test("a reconnect snapshot replaces prior deltas before streaming resumes", () => {
    let turn = startedTurn();
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "Jinx Jinx" });
    turn = applyStreamEvent(turn, {
      type: "snapshot",
      runId: RUN_ID,
      conversationId: CONVERSATION,
      questionMessageId: QUESTION_ID,
      leafIdAtStart: OLD_ANSWER_ID,
      versionCountAtStart: 1,
      startedAt: "2026-08-18T12:00:00.000Z",
      answer: "Jinx",
      activity: "Querying match data.",
      trace: [],
    });
    turn = applyStreamEvent(turn, { type: "answer_delta", text: " wins." });

    expect(turn.answer).toBe("Jinx wins.");
    expect(turn.activity).toBe("Querying match data.");
    expect(turn.trace).toEqual([]);
    expect(turn.leafIdAtStart).toBe(OLD_ANSWER_ID);
  });

  test("answer deltas accumulate in order", () => {
    let turn = startedTurn();
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "Jinx " });
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "wins." });
    expect(turn.answer).toBe("Jinx wins.");
  });

  test("pairs live tool calls and results by provider call id", () => {
    let turn = applyStreamEvent(startedTurn(), {
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "run_report_query",
      message: "Querying match data.",
      details: {
        kind: "execution",
        queryText: "FROM matches SELECT games",
        ok: null,
        rowsReturned: null,
        rowsScanned: null,
        renderKind: null,
      },
      rawInput: {
        kind: "value",
        value: { queryText: "FROM matches SELECT games" },
        byteLength: 46,
      },
    });
    expect(turn.trace[0]?.status).toBe("running");

    turn = applyStreamEvent(turn, {
      type: "tool_result",
      toolCallId: "tool-1",
      toolName: "run_report_query",
      status: "succeeded",
      message: "Got results.",
      durationMs: 125,
      details: {
        kind: "execution",
        queryText: "FROM matches SELECT games",
        ok: true,
        rowsReturned: 1,
        rowsScanned: 42,
        renderKind: "TABLE",
      },
      rawOutput: null,
    });

    expect(turn.trace).toHaveLength(1);
    expect(turn.trace[0]?.status).toBe("succeeded");
    expect(turn.trace[0]?.durationMs).toBe(125);
    expect(turn.trace[0]?.rawInput?.kind).toBe("value");
  });

  test("final pins the persisted message and replaces the streamed text", () => {
    let turn = startedTurn();
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "Jin" });
    turn = applyStreamEvent(turn, {
      type: "final",
      message: message({
        id: ANSWER_ID,
        role: "assistant",
        parentId: QUESTION_ID,
      }),
      title: "Who wins?",
      quota: [],
    });
    expect(turn.finalMessageId).toBe(ANSWER_ID);
    expect(turn.answer).toBe("Jinx.");
    expect(turn.activity).toBeNull();
  });
});

describe("visiblePending", () => {
  test("hides everything for another conversation", () => {
    const turn = startedTurn();
    expect(visiblePending(turn, OTHER_CONVERSATION, [])).toEqual({
      pendingQuestion: null,
      pendingAnswer: null,
      activity: null,
      stopping: false,
      trace: [],
      preview: null,
      visualization: null,
    });
  });

  test("matches a not-yet-created conversation to the new view", () => {
    const turn = createPendingTurn({
      conversationId: null,
      question: "Who wins?",
      leafIdAtStart: null,
    });
    expect(visiblePending(turn, null, []).pendingQuestion).toBe("Who wins?");
  });

  test("drops the question once the transcript contains it", () => {
    const turn = startedTurn();
    const persisted = [message({ id: QUESTION_ID, role: "user" })];
    const visible = visiblePending(turn, CONVERSATION, persisted);
    expect(visible.pendingQuestion).toBeNull();
    // The streamed answer still renders — only the question deduplicates.
    expect(visible.activity).not.toBeNull();
  });

  test("drops the answer once the turn has landed", () => {
    let turn = startedTurn();
    turn = applyStreamEvent(turn, { type: "answer_delta", text: "Jinx." });
    turn = applyStreamEvent(turn, {
      type: "final",
      message: message({
        id: ANSWER_ID,
        role: "assistant",
        parentId: QUESTION_ID,
      }),
      title: "Who wins?",
      quota: [],
    });
    const persisted = [
      message({ id: QUESTION_ID, role: "user" }),
      message({ id: ANSWER_ID, role: "assistant", parentId: QUESTION_ID }),
    ];
    expect(visiblePending(turn, CONVERSATION, persisted)).toEqual({
      pendingQuestion: null,
      pendingAnswer: null,
      activity: null,
      stopping: false,
      trace: [],
      preview: null,
      visualization: null,
    });
  });
});

describe("turnHasLanded", () => {
  test("sees a salvage row under the question", () => {
    // A stop never gets `final`, so landing is recognised structurally.
    const turn = markStopping(
      applyStreamEvent(startedTurn(), { type: "answer_delta", text: "Jin" }),
    );
    const persisted = [
      message({ id: QUESTION_ID, role: "user" }),
      message({ id: ANSWER_ID, role: "assistant", parentId: QUESTION_ID }),
    ];
    expect(turnHasLanded(turn, persisted)).toBe(true);
  });

  test("ignores the pre-existing answer during a regenerate", () => {
    // Regenerating starts with the old answer already on the path; that row
    // must not read as the new turn having landed.
    const started = applyStreamEvent(
      createPendingTurn({
        conversationId: CONVERSATION,
        question: null,
        leafIdAtStart: OLD_ANSWER_ID,
      }),
      {
        type: "started",
        runId: RUN_ID,
        conversationId: CONVERSATION,
        questionMessageId: QUESTION_ID,
      },
    );
    const persisted = [
      message({ id: QUESTION_ID, role: "user" }),
      message({ id: OLD_ANSWER_ID, role: "assistant", parentId: QUESTION_ID }),
    ];
    expect(turnHasLanded(started, persisted)).toBe(false);
  });

  test("is false while only the question is persisted", () => {
    const turn = startedTurn();
    expect(
      turnHasLanded(turn, [message({ id: QUESTION_ID, role: "user" })]),
    ).toBe(false);
  });
});

function beforeStarted(question: string | null = "Who wins?") {
  return createPendingTurn({
    conversationId: CONVERSATION,
    question,
    leafIdAtStart: null,
  });
}

/**
 * The window between the server persisting the question and `started`
 * reaching the client. A refetch landing here used to render the question
 * twice — once from the transcript, once from the pending turn.
 */
describe("visiblePending before `started` arrives", () => {
  test("hides the optimistic question once the transcript carries it", () => {
    const turn = beforeStarted();
    const persisted = [message({ id: QUESTION_ID, role: "user" })];

    expect(turn.questionMessageId).toBeNull();
    expect(visiblePending(turn, CONVERSATION, persisted).pendingQuestion).toBe(
      null,
    );
  });

  test("matches its persisted row even when the question was typed with padding", () => {
    // The server trims before persisting; the composer hands the hook raw
    // text. A strict comparison therefore misses, and the optimistic question
    // keeps rendering beside the row that already arrived — the exact double
    // render this check exists to stop.
    const turn = beforeStarted("  Who wins?  ");
    const persisted = [
      message({ id: QUESTION_ID, role: "user", content: "Who wins?" }),
    ];

    expect(visiblePending(turn, CONVERSATION, persisted).pendingQuestion).toBe(
      null,
    );
  });

  test("still shows it while the transcript has not caught up", () => {
    expect(
      visiblePending(beforeStarted(), CONVERSATION, []).pendingQuestion,
    ).toBe("Who wins?");
  });

  test("does not mistake the leaf that was already on screen for this turn", () => {
    const turn = createPendingTurn({
      conversationId: CONVERSATION,
      question: "Who wins?",
      leafIdAtStart: QUESTION_ID,
    });
    const unchanged = [message({ id: QUESTION_ID, role: "user" })];

    expect(visiblePending(turn, CONVERSATION, unchanged).pendingQuestion).toBe(
      "Who wins?",
    );
  });

  test("does not match a different question with the same shape", () => {
    const turn = beforeStarted("Who loses?");
    const persisted = [message({ id: QUESTION_ID, role: "user" })];

    expect(visiblePending(turn, CONVERSATION, persisted).pendingQuestion).toBe(
      "Who loses?",
    );
  });

  test("a regenerate has no question to duplicate", () => {
    const turn = beforeStarted(null);
    const persisted = [message({ id: QUESTION_ID, role: "user" })];

    expect(visiblePending(turn, CONVERSATION, persisted).pendingQuestion).toBe(
      null,
    );
  });

  test("an answer already under the question is not a question row", () => {
    const turn = beforeStarted();
    const persisted = [
      message({ id: QUESTION_ID, role: "user" }),
      message({ id: ANSWER_ID, role: "assistant", parentId: QUESTION_ID }),
    ];

    expect(visiblePending(turn, CONVERSATION, persisted).pendingQuestion).toBe(
      null,
    );
  });
});

describe("streamed query results", () => {
  const PREVIEW = ReportAiPreviewSummarySchema.parse({
    columns: [
      { key: "label", label: "Champion", format: "text" },
      { key: "games", label: "Games", format: "integer" },
    ],
    rows: [{ label: "Jinx", values: [{ column: "games", value: 84 }] }],
    visualizationRows: [],
    rowsReturned: 1,
    rowsScanned: 1284,
    renderKind: "TABLE",
  });

  test("renders a query result as soon as the preview event arrives", () => {
    // The regression this pins: `preview` used to be folded into the same
    // no-op branch as `done`, so the table the server had already sent only
    // appeared once the whole turn landed.
    const turn = applyStreamEvent(startedTurn(), {
      type: "preview",
      preview: PREVIEW,
      visualization: null,
    });
    expect(turn.preview?.rows).toHaveLength(1);
    expect(turn.preview?.rowsScanned).toBe(1284);
  });

  test("a later query replaces an earlier one", () => {
    // Last write wins, matching the agent's own `lastPreview`, so a
    // reconnecting reader never sees an earlier query's table beside a later
    // query's answer.
    let turn = applyStreamEvent(startedTurn(), {
      type: "preview",
      preview: PREVIEW,
      visualization: null,
    });
    turn = applyStreamEvent(turn, {
      type: "preview",
      preview: { ...PREVIEW, rows: [], rowsReturned: 0, rowsScanned: 7 },
      visualization: null,
    });
    expect(turn.preview?.rowsScanned).toBe(7);
  });

  test("a reconnect restores the table and drops a possibly stale chart", () => {
    // The snapshot deliberately carries no visualization — it can be far
    // larger than the table, and the durable observer re-sends the whole
    // snapshot roughly once a second. So the chart this client is holding may
    // belong to an earlier query than the preview the snapshot just brought,
    // and `ExploreTurnResult` gives a chart precedence over a table: keeping
    // it would render query A's chart above query B's numbers.
    let turn = applyStreamEvent(startedTurn(), {
      type: "preview",
      preview: PREVIEW,
      visualization: null,
    });
    turn = applyStreamEvent(turn, {
      type: "snapshot",
      runId: RUN_ID,
      conversationId: CONVERSATION,
      questionMessageId: QUESTION_ID,
      leafIdAtStart: null,
      versionCountAtStart: 0,
      startedAt: "2026-08-18T12:00:00.000Z",
      answer: "Jinx",
      activity: "Querying match data.",
      trace: [],
    });
    // The snapshot clears the result; the companion event restores it.
    expect(turn.preview).toBeNull();

    turn = applyStreamEvent(turn, {
      type: "run_preview",
      preview: PREVIEW,
      ignorable: true,
    });
    expect(turn.preview?.rowsScanned).toBe(1284);
    expect(turn.visualization).toBeNull();
  });

  test("a reconnect after a second query does not keep the first chart", () => {
    const chart = VisualizationSnapshotSchema.parse({
      version: 1,
      generatedAt: "2026-08-18T12:00:00.000Z",
      kind: "line_chart",
      title: "Games per week",
      temporal: null,
      bucket: null,
      display: {
        theme: null,
        palette: null,
        smooth: false,
        stack: "none",
        rollingWindow: null,
        cumulative: false,
        sparkline: false,
      },
      series: [],
      annotations: [],
      trends: [],
    });
    let turn = applyStreamEvent(startedTurn(), {
      type: "preview",
      preview: PREVIEW,
      visualization: chart,
    });
    expect(turn.visualization).not.toBeNull();

    turn = applyStreamEvent(turn, {
      type: "snapshot",
      runId: RUN_ID,
      conversationId: CONVERSATION,
      questionMessageId: QUESTION_ID,
      leafIdAtStart: null,
      versionCountAtStart: 0,
      startedAt: "2026-08-18T12:00:00.000Z",
      answer: "Jinx",
      activity: "Querying match data.",
      trace: [],
    });
    turn = applyStreamEvent(turn, {
      type: "run_preview",
      preview: { ...PREVIEW, rowsScanned: 7 },
      ignorable: true,
    });

    // The newest table with no chart, rather than the newest table under the
    // previous query's chart.
    expect(turn.preview?.rowsScanned).toBe(7);
    expect(turn.visualization).toBeNull();
  });

  test("stops rendering its own copy once the turn has landed", () => {
    let turn = applyStreamEvent(startedTurn(), {
      type: "preview",
      preview: PREVIEW,
      visualization: null,
    });
    const persisted = message({
      id: ANSWER_ID,
      role: "assistant",
      parentId: QUESTION_ID,
    });
    turn = applyStreamEvent(turn, {
      type: "final",
      message: persisted,
      title: "Who wins?",
      quota: [],
    });
    // The persisted message owns the result from here on; a pending copy
    // beside it would render the table twice.
    expect(visiblePending(turn, CONVERSATION, [persisted]).preview).toBeNull();
  });
});

describe("the status line and the step list are separate concerns", () => {
  test("only an activity event moves the status line", () => {
    // They used to be updated on adjacent lines of one branch, which is how
    // the generic, share-safe trace string ended up being what the reader saw
    // as live status. A tool event now builds the timeline and nothing else.
    let turn = applyStreamEvent(startedTurn(), {
      type: "activity",
      text: "Finding “Jerred#NA1”",
      toolCallId: "call-1",
      ignorable: true,
    });
    expect(turn.activity).toBe("Finding “Jerred#NA1”");

    turn = applyStreamEvent(turn, {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "resolve_player",
      message: "Looking up who that is.",
      details: null,
      rawInput: null,
    });
    expect(turn.activity).toBe("Finding “Jerred#NA1”");
    expect(turn.trace).toHaveLength(1);
    expect(turn.trace[0]?.message).toBe("Looking up who that is.");

    turn = applyStreamEvent(turn, {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "resolve_player",
      status: "succeeded",
      message: "Identified the player.",
      durationMs: 12,
      details: null,
      rawOutput: null,
    });
    expect(turn.activity).toBe("Finding “Jerred#NA1”");
    expect(turn.trace[0]?.status).toBe("succeeded");
  });
});
