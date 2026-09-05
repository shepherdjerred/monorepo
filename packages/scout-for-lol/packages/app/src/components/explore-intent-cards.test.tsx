import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import {
  DiscordGuildIdSchema,
  ExploreMessageSchema,
  type CreationIntentKind,
  type ExploreMessage,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import { CreationConfirmationView } from "#src/components/explore-creation-intent-card.tsx";
import { ExploreTranscript } from "#src/components/explore-transcript.tsx";
import {
  intentCardsFromTrace,
  type CreationIntentCardData,
} from "#src/lib/explore-intent-cards.ts";
import type { CreationConfirmationOutcome } from "#src/lib/intent-confirmation.ts";
import { TRPCProvider, trpcClient } from "#src/lib/trpc.ts";

const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const ANSWER_ID = "44444444-4444-4444-8444-444444444444";
const INTENT_ID = "55555555-5555-4555-8555-555555555555";
const GUILD_ID = DiscordGuildIdSchema.parse("1337623164146155593");
// The transcript renders against the real clock, so a fixture intent has to
// still be alive for the owner's card to read as pending.
const EXPIRES_AT = new Date(Date.now() + 9 * 60_000).toISOString();

function creationIntent(kind: CreationIntentKind): CreationIntentCardData {
  return {
    intentId: INTENT_ID,
    kind,
    guildId: GUILD_ID,
    expiresAt: EXPIRES_AT,
    summary: "A weekly KDA report in #general every Monday at 9am.",
  };
}

function creationTrace(kind: CreationIntentKind): ExploreTraceEntry[] {
  return [
    {
      toolCallId: "creation-call-1",
      toolName: `prepare_${kind}`,
      message: "Nothing has been created yet.",
      status: "succeeded",
      durationMs: 30,
      details: null,
      rawInput: null,
      rawOutput: {
        kind: "value",
        value: {
          kind: "creation_confirmation_required",
          message: "Nothing has been created yet.",
          intent: creationIntent(kind),
        },
        byteLength: 320,
      },
    },
  ];
}

function assistantMessage(trace: ExploreTraceEntry[]): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: ANSWER_ID,
    role: "assistant",
    parentId: QUESTION_ID,
    content: "Ready when you are.",
    createdAt: "2026-08-14T12:00:30.000Z",
    trace,
  });
}

/**
 * The owner's transcript renders live cards, so it needs the query and tRPC
 * providers the page supplies. Nothing fetches: `renderToStaticMarkup` runs no
 * effects, so every card renders its unconfirmed state.
 */
function renderOwnerTranscript(trace: ExploreTraceEntry[]): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <MemoryRouter>
          <ExploreTranscript
            messages={[assistantMessage(trace)]}
            showRawTrace
          />
        </MemoryRouter>
      </TRPCProvider>
    </QueryClientProvider>,
  );
}

function renderView(props: {
  kind: CreationIntentKind;
  outcome: CreationConfirmationOutcome | null;
  expiresInMs: number;
  expired: boolean;
  confirming: boolean;
}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <CreationConfirmationView
        intent={creationIntent(props.kind)}
        outcome={props.outcome}
        expiresInMs={props.expiresInMs}
        expired={props.expired}
        confirming={props.confirming}
        errorMessage={null}
        onConfirm={() => null}
      />
    </MemoryRouter>,
  );
}

function pendingView(kind: CreationIntentKind): string {
  return renderView({
    kind,
    outcome: null,
    expiresInMs: 9 * 60 * 1000,
    expired: false,
    confirming: false,
  });
}

function confirmedView(
  kind: CreationIntentKind,
  entityId: number,
  message = "Created.",
): string {
  return renderView({
    kind,
    outcome: {
      status: "confirmed",
      message,
      created: { entity: kind, entityId, guildId: GUILD_ID },
    },
    expiresInMs: 0,
    expired: true,
    confirming: false,
  });
}

describe("creation cards in the transcript", () => {
  test("reads one card per prepared creation and none from a refusal", () => {
    expect(intentCardsFromTrace(creationTrace("report"))).toEqual([
      { kind: "creation_intent", data: creationIntent("report") },
    ]);

    // A refusal carries `intent: null`, and must not produce an empty card.
    const refusedTrace: ExploreTraceEntry[] = [
      {
        toolCallId: "creation-call-1",
        toolName: "prepare_report",
        message: "Not a server you can create in.",
        status: "succeeded",
        durationMs: 30,
        details: null,
        rawInput: null,
        rawOutput: {
          kind: "value",
          value: {
            kind: "forbidden_target",
            message: "Not a server you can create in.",
            intent: null,
          },
          byteLength: 90,
        },
      },
    ];
    expect(intentCardsFromTrace(refusedTrace)).toEqual([]);
  });

  test("offers the confirmation to the owner and to nobody else", () => {
    // `showRawTrace` is the actor gate: `routes/explore.tsx` passes it, and
    // `routes/explore-shared.tsx` omits it. A confirm button on a shared page
    // would invite a reader who is not the actor to press it.
    const owner = renderOwnerTranscript(creationTrace("competition"));
    expect(owner).toContain("A weekly KDA report in #general");
    expect(owner).toContain("Start this competition");
    expect(owner).toContain('data-confirmation-state="pending"');

    const shared = renderToStaticMarkup(
      <ExploreTranscript
        messages={[assistantMessage(creationTrace("competition"))]}
      />,
    );
    expect(shared).not.toContain("data-confirmation-state");
    expect(shared).not.toContain("Start this competition");
    expect(shared).not.toContain("A weekly KDA report in #general");
  });
});

describe("CreationConfirmationView", () => {
  test("asks for confirmation, saying plainly that nothing exists yet", () => {
    const markup = pendingView("report");
    expect(markup).toContain('data-confirmation-state="pending"');
    expect(markup).toContain("Create this report");
    expect(markup).toContain("Nothing has been created yet.");
    expect(markup).toContain("expires in");
    expect(markup).toContain("09:00");
    expect(markup).not.toContain("disabled");
  });

  test("labels the ask per kind", () => {
    expect(pendingView("subscription")).toContain("Track this player");
    expect(pendingView("competition")).toContain("Start this competition");
  });

  test("disables the button while the confirmation is in flight", () => {
    const markup = renderView({
      kind: "report",
      outcome: null,
      expiresInMs: 60_000,
      expired: false,
      confirming: true,
    });
    expect(markup).toContain('data-confirmation-state="confirming"');
    expect(markup).toContain("Creating…");
    expect(markup).toContain("disabled");
  });

  test("deep-links each confirmed entity to where it now lives", () => {
    const report = confirmedView("report", 7, "Report created.");
    expect(report).toContain('data-confirmation-state="confirmed"');
    expect(report).toContain("Report created");
    expect(report).toContain(`href="/g/${GUILD_ID}/reports/7"`);
    // A settled card drops the countdown rather than showing 00:00.
    expect(report).not.toContain("expires in");

    expect(confirmedView("competition", 12)).toContain(
      `href="/g/${GUILD_ID}/competitions/12"`,
    );
    // Subscriptions have no per-row page, so the list is the destination.
    expect(confirmedView("subscription", 4)).toContain(
      `href="/g/${GUILD_ID}/subscriptions"`,
    );
  });

  test("stops offering an expired confirmation", () => {
    const markup = renderView({
      kind: "subscription",
      outcome: null,
      expiresInMs: -1000,
      expired: true,
      confirming: false,
    });
    expect(markup).toContain('data-confirmation-state="expired"');
    expect(markup).toContain("This confirmation expired");
    expect(markup).toContain("has expired");
    expect(markup).toContain("disabled");
  });

  test("reports a refusal without offering a retry that cannot succeed", () => {
    const markup = renderView({
      kind: "report",
      outcome: {
        status: "failed",
        reason: "limit_reached",
        message: "That server already has 25 reports.",
      },
      expiresInMs: 5 * 60 * 1000,
      expired: false,
      confirming: false,
    });
    expect(markup).toContain('data-confirmation-state="failed"');
    expect(markup).toContain("Report was not created");
    expect(markup).toContain("That server already has 25 reports.");
    expect(markup).not.toContain("<button");
  });
});
