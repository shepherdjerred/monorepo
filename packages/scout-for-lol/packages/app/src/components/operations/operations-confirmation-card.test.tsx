import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OperationsConfirmationView } from "#src/components/operations/operations-confirmation-card.tsx";
import { classifyOperationsConfirmation } from "#src/lib/operations/operations-outcomes.ts";
import {
  operationsRequestSummary,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";

/**
 * The card is the last thing between an operator and a claim on live pipeline
 * state, so what it renders in each settled state is pinned here rather than
 * reviewed by eye — in particular that no answer ever grows a retry control.
 */

const INTENT_KEY = "match:NA1_1234567890/channel:1337623164146155593";
const MATCH_ID = "NA1_1234567890";

function render(props: {
  draft: OperationsRequestDraft;
  result?: unknown;
  expiresInMs?: number;
  expired?: boolean;
  confirming?: boolean;
  errorMessage?: string | null;
}): string {
  return renderToStaticMarkup(
    <OperationsConfirmationView
      kind={props.draft.kind}
      summary={operationsRequestSummary(props.draft)}
      outcome={
        props.result === undefined
          ? null
          : classifyOperationsConfirmation(props.result)
      }
      expiresInMs={props.expiresInMs ?? 5 * 60 * 1000}
      expired={props.expired ?? false}
      confirming={props.confirming ?? false}
      errorMessage={props.errorMessage ?? null}
      onConfirm={() => null}
      onDismiss={() => null}
    />,
  );
}

function buttonCount(markup: string): number {
  return markup.split("<button").length - 1;
}

const RECONCILE: OperationsRequestDraft = { kind: "ops_reconcile_pipeline" };

describe("before an answer", () => {
  test("asks for confirmation and says nothing has happened", () => {
    const markup = render({ draft: RECONCILE });
    expect(markup).toContain('data-confirmation-state="pending"');
    expect(markup).toContain("Reconcile the pipeline");
    expect(markup).toContain("Nothing has happened yet.");
    expect(markup).toContain("expires in");
    expect(markup).toContain("05:00");
    expect(markup).not.toContain("disabled");
  });

  test("closes the button while the confirmation is in flight", () => {
    const markup = render({ draft: RECONCILE, confirming: true });
    expect(markup).toContain('data-confirmation-state="confirming"');
    expect(markup).toContain("Confirming…");
    expect(markup).toContain("disabled");
  });

  test("stops offering an expired confirmation", () => {
    const markup = render({
      draft: RECONCILE,
      expiresInMs: -1000,
      expired: true,
    });
    expect(markup).toContain('data-confirmation-state="expired"');
    expect(markup).toContain("This confirmation expired");
    expect(markup).toContain("disabled");
  });

  test("a transport failure is shown without settling the card", () => {
    const markup = render({
      draft: RECONCILE,
      errorMessage: "Failed to fetch",
    });
    expect(markup).toContain('data-confirmation-state="pending"');
    expect(markup).toContain("Failed to fetch");
  });
});

describe("the six arms' answers", () => {
  test("reconciliation reports the run it started", () => {
    const markup = render({
      draft: RECONCILE,
      result: {
        kind: "executed",
        outcome: { kind: "start-authorized", workflow: "reconcile-pipeline" },
        dispatch: {
          outcome: "started",
          requestedWorkflowId: "scout-recon-beta-operator",
          runId: "run-1",
        },
      },
    });
    expect(markup).toContain('data-confirmation-state="confirmed"');
    expect(markup).toContain('data-operations-effect="performed"');
    expect(markup).toContain("Pipeline reconciliation started");
    expect(markup).toContain("run-1");
    // The recap promised "Nothing is running yet". Leaving it on a settled
    // card would have it contradicting the answer directly beneath it.
    expect(markup).not.toContain("Nothing is running yet");
    expect(markup).not.toContain("Nothing has happened yet.");
  });

  test("a notification re-drive reports its Workflow", () => {
    const markup = render({
      draft: { kind: "ops_retry_notification", intentKey: INTENT_KEY },
      result: {
        kind: "executed",
        outcome: { kind: "start-authorized", workflow: "retry-notification" },
        dispatch: {
          outcome: "started",
          requestedWorkflowId: "scout-notify-beta-key",
          runId: null,
        },
      },
    });
    expect(markup).toContain("Notification retry started");
    expect(markup).toContain("scout-notify-beta-key");
  });

  test("a suppression the machine refuses as not-stale reads as a failure", () => {
    const markup = render({
      draft: {
        kind: "ops_suppress_stale_notification",
        intentKey: INTENT_KEY,
        note: "Riot outage",
      },
      result: {
        kind: "executed",
        outcome: { kind: "machine-refused", reason: "not-stale" },
        dispatch: null,
      },
    });
    expect(markup).toContain('data-confirmation-state="failed"');
    expect(markup).toContain('data-operations-effect="none"');
    expect(markup).toContain("The machine refused");
    expect(markup).toContain("not stale");
    // A refusal is loud, and offers nothing that would repeat it. The only
    // control left is the one that dismisses the card.
    expect(buttonCount(markup)).toBe(1);
    expect(markup).not.toContain(">Confirm<");
  });

  test("a resolved delivery names the state the machine produced", () => {
    const markup = render({
      draft: {
        kind: "ops_resolve_unknown_delivery",
        intentKey: INTENT_KEY,
        attemptNonce: "attempt-3",
        outcome: "not-delivered",
        messageId: "",
        deliveredAt: "",
      },
      result: {
        kind: "executed",
        outcome: {
          kind: "delivery-resolved",
          intentKey: INTENT_KEY,
          intentState: "ready",
        },
        dispatch: null,
      },
    });
    expect(markup).toContain("Delivery resolved");
    expect(markup).toContain("moved the intent to ready");
  });

  test("a projection repair that names no match is a failure", () => {
    const markup = render({
      draft: { kind: "ops_repair_projection", riotMatchId: MATCH_ID },
      result: {
        kind: "executed",
        outcome: { kind: "target-not-found", target: "match", id: MATCH_ID },
        dispatch: null,
      },
    });
    expect(markup).toContain('data-confirmation-state="failed"');
    expect(markup).toContain("Target not found");
    expect(markup).toContain(MATCH_ID);
  });

  test("a widened recovery policy reports its batch", () => {
    const markup = render({
      draft: {
        kind: "ops_release_recovery_policy",
        recoveryBatchId: "batch-7",
      },
      result: {
        kind: "executed",
        outcome: {
          kind: "recovery-policy-released",
          recoveryBatchId: "batch-7",
        },
        dispatch: null,
      },
    });
    expect(markup).toContain('data-operations-effect="performed"');
    expect(markup).toContain("Recovery policy widened");
    expect(markup).toContain("batch-7");
  });
});

describe("terminal answers that moved nothing", () => {
  test("already-accepted is final, detailed, and offers no retry", () => {
    const markup = render({
      draft: { kind: "ops_repair_projection", riotMatchId: MATCH_ID },
      result: {
        kind: "executed",
        outcome: { kind: "start-authorized", workflow: "repair-projection" },
        dispatch: {
          outcome: "already-accepted",
          requestedWorkflowId: "scout-lake-beta-NA1_1234567890",
          acceptedAt: "2026-09-13T10:00:00.000Z",
          runId: "run-first",
        },
      },
    });
    expect(markup).toContain("Already running");
    expect(markup).toContain('data-operations-effect="none"');
    expect(markup).toContain("Nothing was started");
    // The first acceptance is the evidence the durable record kept, so it is
    // shown rather than summarised away.
    expect(markup).toContain("2026-09-13T10:00:00.000Z");
    expect(markup).toContain("run-first");
    // One control, and it dismisses. Nothing here invites asking again.
    expect(buttonCount(markup)).toBe(1);
    expect(markup).toContain(">Done<");
    expect(markup).not.toContain(">Confirm<");
    expect(markup).not.toContain("Retry");
    expect(markup).not.toContain("Try again");
    // A settled card drops the countdown rather than showing 00:00.
    expect(markup).not.toContain("expires in");
  });

  test("a recorded start Temporal never took does not read as running", () => {
    const markup = render({
      draft: RECONCILE,
      result: {
        kind: "executed",
        outcome: { kind: "start-authorized", workflow: "reconcile-pipeline" },
        dispatch: {
          outcome: "unavailable",
          requestedWorkflowId: "scout-recon-beta-operator",
        },
      },
    });
    expect(markup).toContain('data-confirmation-state="failed"');
    expect(markup).toContain("is not running");
    expect(markup).not.toContain("started.");
  });

  test("a replay is reported as the earlier answer", () => {
    const markup = render({
      draft: {
        kind: "ops_suppress_stale_notification",
        intentKey: INTENT_KEY,
        note: "Riot outage",
      },
      result: {
        kind: "already_consumed",
        result: { kind: "notification-suppressed", intentKey: INTENT_KEY },
      },
    });
    expect(markup).toContain("Notification suppressed earlier");
    expect(markup).toContain('data-operations-effect="none"');
    expect(markup).toContain("was already used");
    expect(buttonCount(markup)).toBe(1);
  });
});
