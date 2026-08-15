import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreMessageSchema, type ExploreMessage } from "@scout-for-lol/data";
import { ExploreTranscript } from "#src/components/explore-transcript.tsx";

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

describe("ExploreTranscript", () => {
  test("marks the transcript as a log with an always-mounted polite live region", () => {
    // The live region must exist before content arrives — screen readers
    // only announce additions to a region they already registered.
    const markup = renderToStaticMarkup(<ExploreTranscript messages={[]} />);
    expect(markup).toContain('role="log"');
    expect(markup).toContain('aria-live="polite"');
  });

  test("renders the streaming answer and activity inside the live region", () => {
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
    expect(markup).toContain("Running the query…");
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
  });
});
