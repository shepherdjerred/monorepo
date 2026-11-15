import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreMessageSchema, type ExploreMessage } from "@scout-for-lol/data";
import { ExploreTranscript } from "#src/components/explore/transcript/explore-transcript.tsx";

function assistantMessage(overrides: Record<string, unknown>): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: "44444444-4444-4444-8444-444444444444",
    role: "assistant",
    parentId: "33333333-3333-4333-8333-333333333333",
    content: "Your team has no frontline yet.",
    createdAt: "2026-08-14T12:00:30.000Z",
    ...overrides,
  });
}

const OPTIONS = [
  { label: "Ornn", rationale: "Adds the frontline your team lacks." },
  { label: "Ahri", rationale: "Safe into their picks." },
];

function render(message: ExploreMessage, turnActive = false): string {
  return renderToStaticMarkup(
    <ExploreTranscript
      messages={[message]}
      turnActive={turnActive}
      actions={{ onFollowUp: () => null }}
    />,
  );
}

describe("coach options in the transcript", () => {
  test("render as a labeled list of buttons while a follow-up can be sent", () => {
    const markup = render(assistantMessage({ coachOptions: OPTIONS }));
    expect(markup).toContain('aria-label="Options"');
    expect(markup).toContain("Ornn");
    expect(markup).toContain("Adds the frontline your team lacks.");
    expect(markup).toContain("text-left");
  });

  test("stay readable, without buttons, once a new turn is running", () => {
    const markup = render(assistantMessage({ coachOptions: OPTIONS }), true);
    expect(markup).toContain("Safe into their picks.");
    expect(markup).not.toContain("text-left");
  });

  test("are a plain list in a transcript with no way to send a turn", () => {
    const markup = renderToStaticMarkup(
      <ExploreTranscript
        messages={[assistantMessage({ coachOptions: OPTIONS })]}
      />,
    );
    expect(markup).toContain("Ornn");
    expect(markup).not.toContain("text-left");
  });

  test("do not appear on an answer without any", () => {
    expect(render(assistantMessage({}))).not.toContain('aria-label="Options"');
  });
});
