import { describe, expect, test } from "vitest";
import type { RecoveryBatch } from "#src/recovery/batch.ts";
import {
  abandonBatch,
  advanceScanCursor,
  beginDigest,
  beginProcessing,
  beginScan,
  completeBatch,
  operatorReleasePolicy,
  recordProcessingProgress,
  type RecoveryTransitionResult,
} from "#src/recovery/batch-transitions.ts";
import {
  countsOf,
  makeBatch,
  processingState,
  scanningState,
  statesByKind,
} from "#src/recovery/batch.test-fixtures.ts";

function expectApplied(result: RecoveryTransitionResult): RecoveryBatch {
  if (result.outcome !== "applied") {
    throw new Error(`Expected applied, got ${JSON.stringify(result)}`);
  }
  return result.next;
}

function expectConflict(result: RecoveryTransitionResult, reason: string) {
  expect(result).toEqual({ outcome: "conflict", reason });
}

describe("beginScan", () => {
  test("planned starts scanning with a fresh bounded cursor", () => {
    const next = expectApplied(
      beginScan(makeBatch({ kind: "planned" }), { pageBudget: 3 }),
    );
    expect(next.state).toEqual(scanningState());
  });

  test("replaying against the fresh cursor is idempotent", () => {
    expect(beginScan(makeBatch(scanningState()), { pageBudget: 3 })).toEqual({
      outcome: "already-applied",
    });
  });

  test("a fresh cursor with a different budget conflicts", () => {
    expectConflict(
      beginScan(makeBatch(scanningState()), { pageBudget: 5 }),
      "invalid-source-state",
    );
  });

  test("an advanced scan conflicts", () => {
    expectConflict(
      beginScan(
        makeBatch(scanningState({ position: "page-1", pagesScanned: 1 })),
        { pageBudget: 3 },
      ),
      "invalid-source-state",
    );
  });

  test.each(["processing", "digesting"] as const)("%s conflicts", (kind) => {
    expectConflict(
      beginScan(makeBatch(statesByKind()[kind]), { pageBudget: 3 }),
      "invalid-source-state",
    );
  });

  test.each(["complete", "abandoned"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        beginScan(makeBatch(statesByKind()[kind]), { pageBudget: 3 }),
        "terminal-state",
      );
    },
  );

  test.each([0, -1, 1.5])(
    "a page budget of %d is a broken caller contract",
    (pageBudget) => {
      expect(() =>
        beginScan(makeBatch({ kind: "planned" }), { pageBudget }),
      ).toThrow();
    },
  );
});

describe("advanceScanCursor", () => {
  test("scanning advances one page and counts it", () => {
    const next = expectApplied(
      advanceScanCursor(makeBatch(scanningState()), {
        nextPosition: "page-1",
      }),
    );
    expect(next.state).toEqual(
      scanningState({ position: "page-1", pagesScanned: 1 }),
    );
  });

  test("replaying the same advance is idempotent", () => {
    expect(
      advanceScanCursor(
        makeBatch(scanningState({ position: "page-1", pagesScanned: 1 })),
        { nextPosition: "page-1" },
      ),
    ).toEqual({ outcome: "already-applied" });
  });

  test("advancing past the page budget conflicts", () => {
    expectConflict(
      advanceScanCursor(
        makeBatch(scanningState({ position: "page-3", pagesScanned: 3 })),
        { nextPosition: "page-4" },
      ),
      "scan-budget-exhausted",
    );
  });

  test("replaying the final allowed advance is still idempotent", () => {
    expect(
      advanceScanCursor(
        makeBatch(scanningState({ position: "page-3", pagesScanned: 3 })),
        { nextPosition: "page-3" },
      ),
    ).toEqual({ outcome: "already-applied" });
  });

  test.each(["planned", "processing", "digesting"] as const)(
    "%s conflicts",
    (kind) => {
      expectConflict(
        advanceScanCursor(makeBatch(statesByKind()[kind]), {
          nextPosition: "page-1",
        }),
        "invalid-source-state",
      );
    },
  );

  test.each(["complete", "abandoned"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        advanceScanCursor(makeBatch(statesByKind()[kind]), {
          nextPosition: "page-1",
        }),
        "terminal-state",
      );
    },
  );

  test("an empty resume token is a broken caller contract", () => {
    expect(() =>
      advanceScanCursor(makeBatch(scanningState()), { nextPosition: "" }),
    ).toThrow();
  });
});

describe("beginProcessing", () => {
  test("scanning moves to processing with zeroed outcomes", () => {
    const next = expectApplied(
      beginProcessing(makeBatch(scanningState()), { discovered: 10 }),
    );
    expect(next.state).toEqual(processingState());
  });

  test("replaying with the same discovery is idempotent", () => {
    expect(
      beginProcessing(makeBatch(processingState()), { discovered: 10 }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a different discovery over zeroed outcomes conflicts", () => {
    expectConflict(
      beginProcessing(makeBatch(processingState()), { discovered: 9 }),
      "invalid-source-state",
    );
  });

  test("progressed processing conflicts", () => {
    expectConflict(
      beginProcessing(makeBatch(processingState({ succeeded: 1 })), {
        discovered: 10,
      }),
      "invalid-source-state",
    );
  });

  test.each(["planned", "digesting"] as const)("%s conflicts", (kind) => {
    expectConflict(
      beginProcessing(makeBatch(statesByKind()[kind]), { discovered: 10 }),
      "invalid-source-state",
    );
  });

  test.each(["complete", "abandoned"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        beginProcessing(makeBatch(statesByKind()[kind]), { discovered: 10 }),
        "terminal-state",
      );
    },
  );

  test.each([-1, 1.5])(
    "a discovery count of %d is a broken caller contract",
    (discovered) => {
      expect(() =>
        beginProcessing(makeBatch(scanningState()), { discovered }),
      ).toThrow();
    },
  );
});

describe("recordProcessingProgress", () => {
  test("monotone progress applies", () => {
    const next = expectApplied(
      recordProcessingProgress(makeBatch(processingState()), {
        counts: countsOf({ succeeded: 4, suppressed: 1, failed: 1 }),
      }),
    );
    expect(next.state).toEqual(
      processingState({ succeeded: 4, suppressed: 1, failed: 1 }),
    );
  });

  test("progress up to full accounting applies", () => {
    const next = expectApplied(
      recordProcessingProgress(makeBatch(processingState()), {
        counts: countsOf({ succeeded: 8, suppressed: 1, failed: 1 }),
      }),
    );
    expect(next.state).toEqual(
      processingState({ succeeded: 8, suppressed: 1, failed: 1 }),
    );
  });

  test("replaying identical counts is idempotent", () => {
    expect(
      recordProcessingProgress(makeBatch(processingState({ succeeded: 4 })), {
        counts: countsOf({ succeeded: 4 }),
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("regressing a count conflicts", () => {
    expectConflict(
      recordProcessingProgress(makeBatch(processingState({ succeeded: 4 })), {
        counts: countsOf({ succeeded: 3 }),
      }),
      "counts-regressed",
    );
  });

  test("changing the discovery total conflicts", () => {
    expectConflict(
      recordProcessingProgress(makeBatch(processingState()), {
        counts: countsOf({ discovered: 11 }),
      }),
      "counts-discovered-changed",
    );
  });

  test("accounting for more than was discovered conflicts", () => {
    expectConflict(
      recordProcessingProgress(makeBatch(processingState()), {
        counts: countsOf({ succeeded: 9, suppressed: 1, failed: 1 }),
      }),
      "counts-exceed-discovered",
    );
  });

  test.each(["planned", "scanning", "digesting"] as const)(
    "%s conflicts",
    (kind) => {
      expectConflict(
        recordProcessingProgress(makeBatch(statesByKind()[kind]), {
          counts: countsOf(),
        }),
        "invalid-source-state",
      );
    },
  );

  test.each(["complete", "abandoned"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        recordProcessingProgress(makeBatch(statesByKind()[kind]), {
          counts: countsOf(),
        }),
        "terminal-state",
      );
    },
  );

  test("a negative count is a broken caller contract", () => {
    expect(() =>
      recordProcessingProgress(makeBatch(processingState()), {
        counts: countsOf({ failed: -1 }),
      }),
    ).toThrow();
  });
});

describe("beginDigest", () => {
  test("fully accounted processing digests", () => {
    const next = expectApplied(
      beginDigest(
        makeBatch(processingState({ succeeded: 8, suppressed: 1, failed: 1 })),
      ),
    );
    expect(next.state).toEqual({ kind: "digesting" });
  });

  test("an empty batch digests immediately", () => {
    const next = expectApplied(
      beginDigest(makeBatch(processingState({ discovered: 0 }))),
    );
    expect(next.state).toEqual({ kind: "digesting" });
  });

  test("unaccounted items block the digest", () => {
    expectConflict(
      beginDigest(makeBatch(processingState({ succeeded: 4 }))),
      "items-unaccounted",
    );
  });

  test("replaying the digest is idempotent", () => {
    expect(beginDigest(makeBatch({ kind: "digesting" }))).toEqual({
      outcome: "already-applied",
    });
  });

  test.each(["planned", "scanning"] as const)("%s conflicts", (kind) => {
    expectConflict(
      beginDigest(makeBatch(statesByKind()[kind])),
      "invalid-source-state",
    );
  });

  test.each(["complete", "abandoned"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        beginDigest(makeBatch(statesByKind()[kind])),
        "terminal-state",
      );
    },
  );
});

describe("completeBatch", () => {
  test("digesting completes", () => {
    const next = expectApplied(completeBatch(makeBatch({ kind: "digesting" })));
    expect(next.state).toEqual({ kind: "complete" });
  });

  test("replaying completion is idempotent", () => {
    expect(completeBatch(makeBatch({ kind: "complete" }))).toEqual({
      outcome: "already-applied",
    });
  });

  test.each(["planned", "scanning", "processing"] as const)(
    "%s conflicts",
    (kind) => {
      expectConflict(
        completeBatch(makeBatch(statesByKind()[kind])),
        "invalid-source-state",
      );
    },
  );

  test("abandoned conflicts as terminal", () => {
    expectConflict(
      completeBatch(makeBatch(statesByKind().abandoned)),
      "terminal-state",
    );
  });
});

describe("abandonBatch", () => {
  test.each(["planned", "scanning", "processing", "digesting"] as const)(
    "%s can be abandoned",
    (kind) => {
      const next = expectApplied(
        abandonBatch(makeBatch(statesByKind()[kind]), {
          reason: "upstream-unavailable",
        }),
      );
      expect(next.state).toEqual({
        kind: "abandoned",
        reason: "upstream-unavailable",
      });
    },
  );

  test("replaying with the same reason is idempotent", () => {
    expect(
      abandonBatch(makeBatch(statesByKind().abandoned), {
        reason: "operator-cancelled",
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("abandoning again for a different reason conflicts", () => {
    expectConflict(
      abandonBatch(makeBatch(statesByKind().abandoned), {
        reason: "superseded",
      }),
      "terminal-state",
    );
  });

  test("a completed batch cannot be abandoned", () => {
    expectConflict(
      abandonBatch(makeBatch({ kind: "complete" }), {
        reason: "operator-cancelled",
      }),
      "terminal-state",
    );
  });
});

describe("operatorReleasePolicy", () => {
  test("no-external releases to stale-private-only", () => {
    const batch = makeBatch(scanningState(), "no-external");
    const next = expectApplied(
      operatorReleasePolicy(batch, { to: "stale-private-only" }),
    );
    expect(next.policy).toBe("stale-private-only");
    expect(next.state).toEqual(batch.state);
  });

  test("no-external never releases to normal", () => {
    expectConflict(
      operatorReleasePolicy(makeBatch(scanningState(), "no-external"), {
        to: "normal",
      }),
      "policy-release-forbidden",
    );
  });

  test("re-declaring no-external is not a release", () => {
    expectConflict(
      operatorReleasePolicy(makeBatch(scanningState(), "no-external"), {
        to: "no-external",
      }),
      "policy-immutable",
    );
  });

  test("replaying a completed release is idempotent", () => {
    expect(
      operatorReleasePolicy(makeBatch(scanningState(), "stale-private-only"), {
        to: "stale-private-only",
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("stale-private-only never releases to normal", () => {
    expectConflict(
      operatorReleasePolicy(makeBatch(scanningState(), "stale-private-only"), {
        to: "normal",
      }),
      "policy-release-forbidden",
    );
  });

  test("stale-private-only cannot tighten back to no-external", () => {
    expectConflict(
      operatorReleasePolicy(makeBatch(scanningState(), "stale-private-only"), {
        to: "no-external",
      }),
      "policy-immutable",
    );
  });

  test.each(["normal", "stale-private-only", "no-external"] as const)(
    "a normal-policy batch cannot change to %s",
    (to) => {
      expectConflict(
        operatorReleasePolicy(makeBatch(scanningState(), "normal"), { to }),
        "policy-immutable",
      );
    },
  );

  test.each(["complete", "abandoned"] as const)(
    "a release on a %s batch conflicts as terminal",
    (kind) => {
      expectConflict(
        operatorReleasePolicy(makeBatch(statesByKind()[kind], "no-external"), {
          to: "stale-private-only",
        }),
        "terminal-state",
      );
    },
  );
});

describe("state-machine invariants", () => {
  const appliedTransitions: readonly (readonly [
    string,
    RecoveryBatch,
    (batch: RecoveryBatch) => RecoveryTransitionResult,
  ])[] = [
    [
      "beginScan",
      makeBatch({ kind: "planned" }, "no-external"),
      (batch) => beginScan(batch, { pageBudget: 3 }),
    ],
    [
      "advanceScanCursor",
      makeBatch(scanningState(), "no-external"),
      (batch) => advanceScanCursor(batch, { nextPosition: "page-1" }),
    ],
    [
      "beginProcessing",
      makeBatch(scanningState(), "no-external"),
      (batch) => beginProcessing(batch, { discovered: 10 }),
    ],
    [
      "recordProcessingProgress",
      makeBatch(processingState(), "no-external"),
      (batch) =>
        recordProcessingProgress(batch, {
          counts: countsOf({ succeeded: 1 }),
        }),
    ],
    [
      "beginDigest",
      makeBatch(
        processingState({ succeeded: 8, suppressed: 1, failed: 1 }),
        "no-external",
      ),
      (batch) => beginDigest(batch),
    ],
    [
      "completeBatch",
      makeBatch({ kind: "digesting" }, "no-external"),
      (batch) => completeBatch(batch),
    ],
    [
      "abandonBatch",
      makeBatch({ kind: "planned" }, "no-external"),
      (batch) => abandonBatch(batch, { reason: "operator-cancelled" }),
    ],
  ];

  test.each(appliedTransitions)(
    "%s never changes the policy",
    (_name, batch, attempt) => {
      const next = expectApplied(attempt(batch));
      expect(next.policy).toBe(batch.policy);
    },
  );

  test.each(appliedTransitions)(
    "%s does not mutate its input",
    (_name, batch, attempt) => {
      const snapshot = structuredClone(batch);
      attempt(batch);
      expect(batch).toEqual(snapshot);
    },
  );

  const everyAttempt: readonly (readonly [
    string,
    (batch: RecoveryBatch) => RecoveryTransitionResult,
  ])[] = [
    ["beginScan", (batch) => beginScan(batch, { pageBudget: 3 })],
    [
      "advanceScanCursor",
      (batch) => advanceScanCursor(batch, { nextPosition: "page-1" }),
    ],
    ["beginProcessing", (batch) => beginProcessing(batch, { discovered: 10 })],
    [
      "recordProcessingProgress",
      (batch) => recordProcessingProgress(batch, { counts: countsOf() }),
    ],
    ["beginDigest", (batch) => beginDigest(batch)],
    ["completeBatch", (batch) => completeBatch(batch)],
    [
      "abandonBatch",
      (batch) => abandonBatch(batch, { reason: "operator-cancelled" }),
    ],
    [
      "operatorReleasePolicy",
      (batch) => operatorReleasePolicy(batch, { to: "stale-private-only" }),
    ],
  ];

  test.each(
    (["complete", "abandoned"] as const).flatMap((kind) =>
      everyAttempt.map(
        (
          entry,
        ): readonly [
          "complete" | "abandoned",
          string,
          (batch: RecoveryBatch) => RecoveryTransitionResult,
        ] => [kind, entry[0], entry[1]],
      ),
    ),
  )("terminal state %s is never left by %s", (kind, _name, attempt) => {
    const result = attempt(makeBatch(statesByKind()[kind], "no-external"));
    expect(result.outcome).not.toBe("applied");
  });
});
