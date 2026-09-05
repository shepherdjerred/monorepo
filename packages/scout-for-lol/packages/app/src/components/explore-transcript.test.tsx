import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreMessageSchema, type ExploreMessage } from "@scout-for-lol/data";
import { ExploreToolTrace } from "#src/components/explore-tool-trace.tsx";
import {
  ExploreTranscript,
  strandedQuestion,
} from "#src/components/explore-transcript.tsx";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";

const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";

function assistantMessage(overrides: Record<string, unknown>): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: ANSWER_ID,
    role: "assistant",
    parentId: QUESTION_ID,
    content: "Jinx, narrowly.",
    createdAt: "2026-08-14T12:00:30.000Z",
    ...overrides,
  });
}

function renderWithFollowUps(
  messages: ExploreMessage[],
  turnActive = false,
): string {
  return renderToStaticMarkup(
    <ExploreTranscript
      messages={messages}
      turnActive={turnActive}
      actions={{ onFollowUp: () => null }}
    />,
  );
}

describe("ExploreTranscript", () => {
  test("marks the transcript as a log with an always-mounted polite live region", () => {
    // The live region must exist before content arrives — screen readers
    // only announce additions to a region they already registered.
    const markup = renderToStaticMarkup(<ExploreTranscript messages={[]} />);
    expect(markup).toContain('role="log"');
    expect(markup).toContain('aria-live="polite"');
  });

  test("renders the streaming answer inside the live region", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[]}
        pendingQuestion="Who wins?"
        pendingAnswer="Jinx so far"
        activity="Running the query…"
      />,
    );
    expect(markup).toContain("Who wins?");
    expect(markup).toContain("Jinx so far");
    // The status line steps aside once prose is arriving: it describes work
    // in flight, and the answer itself is now the progress. Leaving it up
    // pulsed and timed the last *finished* step for the whole of answer
    // generation.
    expect(markup).not.toContain("Running the query…");
  });

  test("sizes user bubbles against the transcript width", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript messages={[]} pendingQuestion="test" />,
    );

    expect(markup).toContain('<div class="flex w-full justify-end"><p');
  });

  test("renders assistant timestamps as <time> with an absolute title", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript messages={[assistantMessage({})]} />,
    );
    // Structure, not formatted text — the rendered string depends on the
    // machine's timezone.
    expect(markup).toContain("<time");
    expect(markup).toContain('dateTime="2026-08-14T12:00:30.000Z"');
  });

  test("heads the preview table with its dimension label and no stray column", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[
          assistantMessage({
            preview: {
              columns: [
                { key: "label", label: "Player", format: "text" },
                { key: "win_rate", label: "Win rate", format: "percent" },
              ],
              rows: [
                {
                  label: "Faker",
                  values: [{ column: "win_rate", value: 0.5833 }],
                },
              ],
              rowsScanned: 12,
              renderKind: "TABLE",
            },
          }),
        ]}
      />,
    );
    expect(markup).toContain("Player");
    expect(markup).toContain("Faker");
    expect(markup).toContain("58.3%");
    expect(markup).not.toContain(">Row<");
  });

  test("omits the preview table when the preview has no rows", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[
          assistantMessage({
            preview: {
              columns: [{ key: "label", label: "Player", format: "text" }],
              rows: [],
              rowsScanned: 0,
              renderKind: "TABLE",
            },
          }),
        ]}
      />,
    );
    expect(markup).not.toContain("No rows matched");
    expect(markup).not.toContain("<table");
  });

  test("renders query and steps disclosures closed with aria-expanded false", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[
          assistantMessage({
            queryText: "FROM matches SELECT games",
            trace: [
              { toolName: "run_report_query", message: "Ran it.", ok: true },
            ],
          }),
        ]}
      />,
    );
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("ScoutQL query");
    expect(markup).toContain("Steps (1)");

    const queryMarkup = renderToStaticMarkup(
      <ScoutQlCode queryText="FROM matches SELECT games" />,
    );
    expect(queryMarkup).toContain('data-scoutql-token="keyword"');
  });

  test("shows accessible answer actions for copy, regenerate, and more options", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[assistantMessage({})]}
        actions={{ onRegenerate: (message) => message.content }}
      />,
    );

    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain('aria-label="Answer again"');
    expect(markup).toContain('aria-label="More options"');
  });

  test("hides suggested responses as soon as a new turn starts", () => {
    const suggestion = "Compare that with last month";
    const message = assistantMessage({ followUps: [suggestion] });
    const persistedQuestion = ExploreMessageSchema.parse({
      id: "55555555-5555-4555-8555-555555555555",
      role: "user",
      parentId: message.id,
      content: suggestion,
      createdAt: "2026-08-14T12:01:00.000Z",
    });

    expect(renderWithFollowUps([message])).toContain(suggestion);
    expect(renderWithFollowUps([message], true)).not.toContain(
      `>${suggestion}</button>`,
    );
    expect(renderWithFollowUps([message, persistedQuestion])).not.toContain(
      `>${suggestion}</button>`,
    );
  });

  test("renders curated tool details but gates raw JSON to the owner", () => {
    const messageWithTrace = assistantMessage({
      trace: [
        {
          toolCallId: "call-1",
          toolName: "run_report_query",
          message: "Got results.",
          status: "succeeded",
          durationMs: 125,
          details: {
            kind: "execution",
            queryText: "FROM matches SELECT games",
            ok: true,
            rowsReturned: 1,
            rowsScanned: 42,
            renderKind: "TABLE",
          },
          rawInput: {
            kind: "value",
            value: { secret: "owner-only" },
            byteLength: 23,
          },
          rawOutput: null,
        },
      ],
    });

    const sharedMarkup = renderToStaticMarkup(
      <ExploreToolTrace trace={messageWithTrace.trace} showRaw={false} />,
    );
    expect(sharedMarkup).toContain("Run ScoutQL");
    expect(sharedMarkup).toContain("Rows scanned:");
    expect(sharedMarkup).not.toContain("Raw JSON");
    expect(sharedMarkup).not.toContain("owner-only");

    const ownerMarkup = renderToStaticMarkup(
      <ExploreToolTrace trace={messageWithTrace.trace} showRaw />,
    );
    expect(ownerMarkup).toContain("Raw JSON");
    expect(ownerMarkup).toContain("owner-only");
  });

  test("collapses the live timeline while keeping it expandable", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[]}
        pendingTrace={[
          {
            toolCallId: "call-live",
            toolName: "validate_report_query",
            message: "Checking the query.",
            status: "running",
            durationMs: null,
            details: {
              kind: "validation",
              queryText: "FROM matches SELECT games",
              ok: null,
              diagnostics: [],
              formattedQueryText: null,
            },
            rawInput: null,
            rawOutput: null,
          },
        ]}
      />,
    );

    expect(markup).toContain("Steps (1)");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('aria-label="Live tool steps"');
    expect(markup).not.toContain("Validate ScoutQL");
  });
});

describe("Explore live progress", () => {
  test("shows the status line before any prose has arrived", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[]}
        pendingQuestion="Who wins?"
        activity="Running the query…"
      />,
    );
    expect(markup).toContain("Running the query…");
  });

  test("keeps the status line visible once tool steps have started", () => {
    // The regression this pins: the status line used to render only while the
    // trace was empty, so from the first tool call to the final answer — the
    // longest stretch of a turn — the whole visible state was a collapsed
    // `Steps (n)` counter, and the page read as an unexplained wait.
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[]}
        activity="Querying match data."
        pendingTrace={[
          {
            toolCallId: "call-live",
            toolName: "run_report_query",
            message: "Querying match data.",
            status: "running",
            durationMs: null,
            details: null,
            rawInput: null,
            rawOutput: null,
          },
        ]}
      />,
    );

    expect(markup).toContain("Querying match data.");
    expect(markup).toContain("Steps (1)");
  });
});

describe("Explore Dare transcript cards", () => {
  test("renders a private Dare draft card for persisted and streaming owner traces", () => {
    const trace = [
      {
        toolCallId: "dare-call-1",
        toolName: "create_dare_draft",
        message: "The private dare draft was saved.",
        status: "succeeded" as const,
        durationMs: 40,
        details: {
          kind: "execution" as const,
          queryText: "WITH eligible_games AS (...) SELECT achieved",
          ok: true,
          rowsReturned: null,
          rowsScanned: null,
          renderKind: null,
        },
        rawInput: null,
        rawOutput: {
          kind: "value" as const,
          value: {
            kind: "created",
            message: "The private dare draft was saved.",
            data: {
              dareId: 42,
              revision: 1,
              canonicalScoutQl: "WITH eligible_games AS (...) SELECT achieved",
              plainLanguage: "One game: Virmel gets 8 CS/min on Twisted Fate.",
              semanticProofPlan: "Evaluate the same eligible match.",
              openingStake: 20,
              targetAliases: ["Virmel"],
            },
          },
          byteLength: 400,
        },
      },
    ];
    const ownerPersisted = renderToStaticMarkup(
      <ExploreTranscript
        messages={[assistantMessage({ trace })]}
        showRawTrace
      />,
    );
    const ownerStreaming = renderToStaticMarkup(
      <ExploreTranscript messages={[]} pendingTrace={trace} showRawTrace />,
    );
    const shared = renderToStaticMarkup(
      <ExploreTranscript messages={[assistantMessage({ trace })]} />,
    );

    expect(ownerPersisted).toContain("Dare #42 draft");
    expect(ownerStreaming).toContain("Dare #42 draft");
    expect(ownerPersisted).toContain("One game: Virmel gets 8 CS/min");
    expect(shared).not.toContain("Dare #42 draft");
  });

  test("suppresses interrupted turn banner when an error is already present", () => {
    const userMsg = ExploreMessageSchema.parse({
      id: QUESTION_ID,
      role: "user",
      parentId: null,
      content: "Why did we lose?",
      createdAt: "2026-08-14T12:00:00.000Z",
    });

    expect(strandedQuestion([userMsg], false)).toEqual(userMsg);
    expect(strandedQuestion([userMsg], true)).toBeNull();

    const withError = renderToStaticMarkup(
      <ExploreTranscript
        messages={[userMsg]}
        hasError
        actions={{ onRetry: vi.fn() }}
      />,
    );
    expect(withError).not.toContain(
      "This question was interrupted before it was answered.",
    );

    const withoutError = renderToStaticMarkup(
      <ExploreTranscript
        messages={[userMsg]}
        hasError={false}
        actions={{ onRetry: vi.fn() }}
      />,
    );
    expect(withoutError).toContain(
      "This question was interrupted before it was answered.",
    );
    expect(withoutError).toContain("Answer it");
  });
});

describe("Explore stop feedback", () => {
  test("keeps the stopping status visible over a partial answer", () => {
    // A stop only salvages a turn that already streamed something, so the
    // "saving" status arrives exactly when prose exists. Hiding the status
    // line whenever there is prose left the reader watching a frozen answer
    // with nothing to say the stop was still landing.
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[]}
        pendingAnswer="Jinx so far"
        activity="Stopped — saving the partial answer…"
        stopping
      />,
    );
    expect(markup).toContain("Stopped — saving the partial answer…");
  });

  test("still hides a finished tool's status once prose arrives", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[]}
        pendingAnswer="Jinx so far"
        activity="Got results."
      />,
    );
    expect(markup).not.toContain("Got results.");
  });
});
