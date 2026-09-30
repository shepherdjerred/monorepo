import { describe, expect, test } from "vitest";
import {
  classifyOperationsConfirmation,
  type OperationsConfirmationOutcome,
} from "#src/lib/operations/operations-outcomes.ts";

/**
 * These pin the one rule the operations console exists to keep: it never
 * reports an effect that did not happen. `effect` is asserted on every case,
 * because that is the field the reader's trust rests on — `status` only says
 * whether the card looks settled or refused.
 */

const INTENT_KEY = "match:NA1_1/channel:123";
const MATCH_ID = "NA1_1234567890";
const BATCH_ID = "batch-7";

function executed(outcome: unknown, dispatch: unknown = null): unknown {
  return { kind: "executed", outcome, dispatch };
}

/** How one family's start reads when Temporal refused to reuse the id. */
function alreadyRun(workflow: string): OperationsConfirmationOutcome {
  return classifyOperationsConfirmation(
    executed(
      { kind: "start-authorized", workflow },
      { outcome: "already-run", requestedWorkflowId: "wf-1" },
    ),
  );
}

/** How one family's start reads when Temporal never accepted it. */
function unavailableMessage(workflow: string): string {
  return classifyOperationsConfirmation(
    executed(
      { kind: "start-authorized", workflow },
      { outcome: "unavailable", requestedWorkflowId: "wf-1" },
    ),
  ).message;
}

describe("Workflow-start arms", () => {
  test("reports the running Workflow without claiming this call began it", () => {
    const result = classifyOperationsConfirmation(
      executed(
        { kind: "start-authorized", workflow: "reconcile-pipeline" },
        {
          outcome: "reached-running",
          requestedWorkflowId: "scout-recon-beta-operator",
          runId: "run-1",
        },
      ),
    );
    expect(result.status).toBe("confirmed");
    // The operator gets the run and no claim of authorship: Temporal joins an
    // open run and does not report which happened, so `performed` here would
    // be the console asserting something it cannot know.
    expect(result.effect).toBe("none");
    expect(result.heading).toBe("Pipeline reconciliation is running");
    expect(result.message).toContain("does not claim");
    expect(result.facts).toContainEqual({ label: "Run", value: "run-1" });
  });

  test("joined-running is settled and claims nothing new was started", () => {
    const result = classifyOperationsConfirmation(
      executed(
        { kind: "start-authorized", workflow: "repair-projection" },
        {
          outcome: "joined-running",
          requestedWorkflowId: "scout-lake-beta-NA1_1234567890",
          runId: "run-first",
        },
      ),
    );
    // Settled rather than broken — the run the operator wanted exists — but
    // this confirmation did not produce it, so `effect` says so.
    expect(result.status).toBe("confirmed");
    expect(result.effect).toBe("none");
    expect(result.heading).toBe("Already running");
    expect(result.message).toContain("Nothing new was started");
    expect(result.message).toContain("joined that run");
    expect(result.reason).toBe("joined-running");
    expect(result.facts).toContainEqual({ label: "Run", value: "run-first" });
  });

  test("an unreachable Temporal is a failure, not a quiet success", () => {
    const result = classifyOperationsConfirmation(
      executed(
        { kind: "start-authorized", workflow: "retry-notification" },
        {
          outcome: "unavailable",
          requestedWorkflowId: "scout-notify-beta-key",
        },
      ),
    );
    expect(result.status).toBe("failed");
    expect(result.effect).toBe("none");
    expect(result.message).toContain("is not running");
    expect(result.reason).toBe("temporal-unavailable");
  });

  test("an unaccepted start says what recovers THAT family, not both rules", () => {
    // The sweep re-drives the foldable families.
    expect(unavailableMessage("retry-notification")).toContain(
      "re-drives unaccepted notification starts",
    );
    expect(unavailableMessage("repair-projection")).toContain(
      "re-drives unaccepted lake-projection starts",
    );

    // It deliberately refuses to fold a reconciliation start, so telling an
    // operator to wait for the sweep would be telling them to wait forever.
    const reconcile = unavailableMessage("reconcile-pipeline");
    expect(reconcile).toContain("Nothing will pick this up on its own");
    expect(reconcile).toContain("Request it again");
    expect(reconcile).not.toContain("is picked up once Temporal is reachable");
  });

  test("already-run reports only what each family's reuse policy proves", () => {
    // Lake projection runs ALLOW_DUPLICATE_FAILED_ONLY, which re-runs after a
    // failure — so a refusal proves the previous run did NOT fail.
    const projection = alreadyRun("repair-projection");
    expect(projection.status).toBe("confirmed");
    expect(projection.effect).toBe("none");
    expect(projection.message).toContain("already ran to completion");
    expect(projection.message).toContain("Nothing was started");

    // Reconciliation and notification allow duplicates outright, so this
    // answer contradicts the policy and is reported as a system fact, not an
    // operator failure — and never as a completed sweep.
    const reconcile = alreadyRun("reconcile-pipeline");
    expect(reconcile.message).toContain("disagree");
    expect(reconcile.message).not.toContain("ran to completion");
    expect(reconcile.status).toBe("failed");
    expect(alreadyRun("retry-notification").message).toContain("disagree");
  });

  test("the three non-start outcomes never read the same", () => {
    // All three moved nothing, and that is the only thing they share: the run
    // was already open and joined, Temporal refused the id, or nothing was
    // reachable at all. Each demands something different of the operator.
    const shared = { kind: "start-authorized", workflow: "repair-projection" };
    const all = [
      classifyOperationsConfirmation(
        executed(shared, {
          outcome: "joined-running",
          requestedWorkflowId: "wf-1",
          runId: "run-first",
        }),
      ),
      classifyOperationsConfirmation(
        executed(shared, {
          outcome: "already-run",
          requestedWorkflowId: "wf-1",
        }),
      ),
      classifyOperationsConfirmation(
        executed(shared, {
          outcome: "unavailable",
          requestedWorkflowId: "wf-1",
        }),
      ),
    ];

    for (const outcome of all) {
      expect(outcome.effect).toBe("none");
    }
    // Pairwise distinct on every field that carries meaning.
    expect(new Set(all.map((outcome) => outcome.heading)).size).toBe(3);
    expect(new Set(all.map((outcome) => outcome.reason)).size).toBe(3);
    expect(new Set(all.map((outcome) => outcome.message)).size).toBe(3);

    expect(all[0]?.message).toContain("joined that run");
    expect(all[1]?.message).toContain("already ran to completion");
    expect(all[2]?.message).toContain("is not running");
  });

  test("an authorized start with no dispatch is reported, never guessed", () => {
    const result = classifyOperationsConfirmation(
      executed({ kind: "start-authorized", workflow: "reconcile-pipeline" }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("missing-dispatch");
  });
});

describe("durable-transition arms", () => {
  test("a suppression reports the machine's own move", () => {
    const result = classifyOperationsConfirmation(
      executed({
        kind: "notification-suppressed",
        intentKey: INTENT_KEY,
      }),
    );
    expect(result.status).toBe("confirmed");
    expect(result.effect).toBe("performed");
    expect(result.heading).toBe("Notification suppressed");
  });

  test("not-stale is a loud, readable refusal", () => {
    const result = classifyOperationsConfirmation(
      executed({ kind: "machine-refused", reason: "not-stale" }),
    );
    expect(result.status).toBe("failed");
    expect(result.effect).toBe("none");
    expect(result.reason).toBe("not-stale");
    expect(result.message).toContain("freshness deadline has not passed");
  });

  test("a resolved delivery names the state the machine produced", () => {
    const result = classifyOperationsConfirmation(
      executed({
        kind: "delivery-resolved",
        intentKey: INTENT_KEY,
        intentState: "ready",
      }),
    );
    expect(result.status).toBe("confirmed");
    expect(result.effect).toBe("performed");
    expect(result.message).toContain("moved the intent to ready");
  });

  test("a stale operator view is refused rather than smoothed over", () => {
    const result = classifyOperationsConfirmation(
      executed({ kind: "machine-refused", reason: "stale-operator-view" }),
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("older attempt");
  });

  test("a widened recovery policy reports the batch it moved", () => {
    const result = classifyOperationsConfirmation(
      executed({
        kind: "recovery-policy-released",
        recoveryBatchId: BATCH_ID,
      }),
    );
    expect(result.status).toBe("confirmed");
    expect(result.effect).toBe("performed");
    expect(result.facts).toContainEqual({ label: "Batch", value: BATCH_ID });
  });

  test("a forbidden policy release is a refusal", () => {
    const result = classifyOperationsConfirmation(
      executed({
        kind: "machine-refused",
        reason: "policy-release-forbidden",
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("policy-release-forbidden");
  });
});

describe("answers that moved nothing", () => {
  test("already-applied is settled without claiming this call did it", () => {
    const result = classifyOperationsConfirmation(
      executed({ kind: "already-applied" }),
    );
    expect(result.status).toBe("confirmed");
    expect(result.effect).toBe("none");
    expect(result.message).toContain("moved nothing");
  });

  test("a not-drivable intent says which state blocked it", () => {
    const result = classifyOperationsConfirmation(
      executed({
        kind: "not-drivable",
        intentKey: INTENT_KEY,
        intentState: "sending",
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.facts).toContainEqual({ label: "State", value: "sending" });
  });

  test("a missing target names what was looked for", () => {
    const result = classifyOperationsConfirmation(
      executed({ kind: "target-not-found", target: "match", id: MATCH_ID }),
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("no match with that id");
    expect(result.facts).toContainEqual({ label: "Id", value: MATCH_ID });
  });

  test("an expired intent claimed nothing and ran nothing", () => {
    const result = classifyOperationsConfirmation({ kind: "intent_expired" });
    expect(result.status).toBe("failed");
    expect(result.effect).toBe("none");
    expect(result.message).toContain("Nothing was claimed");
  });
});

describe("replays", () => {
  test("a replayed transition is reported as the earlier answer", () => {
    const result = classifyOperationsConfirmation({
      kind: "already_consumed",
      result: { kind: "notification-suppressed", intentKey: INTENT_KEY },
    });
    expect(result.status).toBe("confirmed");
    expect(result.effect).toBe("none");
    expect(result.heading).toBe("Notification suppressed earlier");
    expect(result.message).toContain("was already used");
  });

  test("a replayed start does not claim a dispatch it cannot know about", () => {
    const result = classifyOperationsConfirmation({
      kind: "already_consumed",
      result: { kind: "start-authorized", workflow: "reconcile-pipeline" },
    });
    expect(result.effect).toBe("none");
    expect(result.message).toContain("not recorded on the intent");
    // The dispatch happened after the transaction, so there is nothing here to
    // report about it — and nothing invented.
    expect(result.facts).toEqual([]);
  });

  test("an unreadable stored answer still reads as spent", () => {
    const result = classifyOperationsConfirmation({
      kind: "already_consumed",
      result: { kind: "something-else" },
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("unreadable-replay");
  });
});

test("an answer this console cannot parse is refused loudly", () => {
  expect(classifyOperationsConfirmation({ kind: "surprise" })).toMatchObject({
    status: "failed",
    effect: "none",
    reason: "unreadable",
  });
  // A workflow kind outside the closed set is drift, not a new feature.
  expect(
    classifyOperationsConfirmation(
      executed({ kind: "start-authorized", workflow: "invent-something" }),
    ).reason,
  ).toBe("unreadable");
});
