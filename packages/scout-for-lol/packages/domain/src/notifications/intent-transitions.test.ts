import { describe, expect, test } from "vitest";
import type { NotificationIntent } from "#src/notifications/intent.ts";
import {
  beginSend,
  confirmDelivered,
  expire,
  markReady,
  operatorResolveUnknown,
  recordFailure,
  recordUnknownDelivery,
  suppressStale,
  type NotificationTransitionResult,
} from "#src/notifications/intent-transitions.ts";
import {
  afterDeadline,
  afterDeadlineWithOffset,
  beforeDeadline,
  deliveredAt,
  deliveredWithMessageState,
  exactDeadline,
  makeIntent,
  messageId,
  nonceA,
  nonceB,
  observedAt,
  otherMessageId,
  sendingState,
  statesByKind,
  unknownDeliveryState,
} from "#src/notifications/intent.test-fixtures.ts";

const terminalKinds = [
  "delivered",
  "suppressed",
  "expired",
  "permission-denied",
] as const;

function terminalIntents(): readonly (readonly [string, NotificationIntent])[] {
  const states = statesByKind();
  return terminalKinds.map((kind) => [kind, makeIntent(states[kind])]);
}

function expectApplied(
  result: NotificationTransitionResult,
): NotificationIntent {
  if (result.outcome !== "applied") {
    throw new Error(`Expected applied, got ${JSON.stringify(result)}`);
  }
  return result.next;
}

function expectConflict(result: NotificationTransitionResult, reason: string) {
  expect(result).toEqual({ outcome: "conflict", reason });
}

describe("markReady", () => {
  test("pending becomes ready", () => {
    const next = expectApplied(markReady(makeIntent({ kind: "pending" })));
    expect(next.state).toEqual({ kind: "ready" });
  });

  test("ready is an idempotent replay", () => {
    expect(markReady(makeIntent({ kind: "ready" }))).toEqual({
      outcome: "already-applied",
    });
  });

  test("sending conflicts", () => {
    expectConflict(
      markReady(makeIntent(sendingState())),
      "invalid-source-state",
    );
  });

  test("unknown-delivery requires the operator", () => {
    expectConflict(
      markReady(makeIntent(unknownDeliveryState())),
      "unknown-delivery-requires-operator",
    );
  });

  test.each(terminalIntents())("%s conflicts as terminal", (_kind, intent) => {
    expectConflict(markReady(intent), "terminal-state");
  });
});

describe("beginSend", () => {
  test("ready starts a send and counts the attempt", () => {
    const next = expectApplied(
      beginSend(makeIntent({ kind: "ready" }), {
        attemptNonce: nonceA,
        startedAt: beforeDeadline,
      }),
    );
    expect(next.state).toEqual(sendingState());
    expect(next.attemptCount).toBe(1);
  });

  test("a send exactly at the freshness deadline is still allowed", () => {
    const next = expectApplied(
      beginSend(makeIntent({ kind: "ready" }), {
        attemptNonce: nonceA,
        startedAt: exactDeadline,
      }),
    );
    expect(next.state.kind).toBe("sending");
  });

  test("a send after the freshness deadline conflicts", () => {
    expectConflict(
      beginSend(makeIntent({ kind: "ready" }), {
        attemptNonce: nonceA,
        startedAt: afterDeadline,
      }),
      "freshness-deadline-passed",
    );
  });

  test("staleness is compared by instant, not by string", () => {
    expectConflict(
      beginSend(makeIntent({ kind: "ready" }), {
        attemptNonce: nonceA,
        startedAt: afterDeadlineWithOffset,
      }),
      "freshness-deadline-passed",
    );
  });

  test("replaying the in-flight attempt is idempotent", () => {
    expect(
      beginSend(makeIntent(sendingState()), {
        attemptNonce: nonceA,
        startedAt: beforeDeadline,
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a second attempt while one is in flight conflicts", () => {
    expectConflict(
      beginSend(makeIntent(sendingState()), {
        attemptNonce: nonceB,
        startedAt: beforeDeadline,
      }),
      "already-sending",
    );
  });

  test("pending conflicts", () => {
    expectConflict(
      beginSend(makeIntent({ kind: "pending" }), {
        attemptNonce: nonceA,
        startedAt: beforeDeadline,
      }),
      "invalid-source-state",
    );
  });

  test("unknown-delivery requires the operator", () => {
    expectConflict(
      beginSend(makeIntent(unknownDeliveryState()), {
        attemptNonce: nonceB,
        startedAt: beforeDeadline,
      }),
      "unknown-delivery-requires-operator",
    );
  });

  test.each(terminalIntents())("%s conflicts as terminal", (_kind, intent) => {
    expectConflict(
      beginSend(intent, { attemptNonce: nonceA, startedAt: beforeDeadline }),
      "terminal-state",
    );
  });
});

describe("confirmDelivered", () => {
  test("a nonce-matching confirmation delivers with a message id", () => {
    const next = expectApplied(
      confirmDelivered(makeIntent(sendingState()), {
        attemptNonce: nonceA,
        messageId,
        deliveredAt,
      }),
    );
    expect(next.state).toEqual({ kind: "delivered", messageId, deliveredAt });
  });

  test("a nonce-matching confirmation delivers without a message id", () => {
    const next = expectApplied(
      confirmDelivered(makeIntent(sendingState()), {
        attemptNonce: nonceA,
        deliveredAt,
      }),
    );
    expect(next.state).toEqual({ kind: "delivered", deliveredAt });
  });

  test("a stale worker's confirmation conflicts on nonce", () => {
    expectConflict(
      confirmDelivered(makeIntent(sendingState()), {
        attemptNonce: nonceB,
        messageId,
        deliveredAt,
      }),
      "attempt-nonce-mismatch",
    );
  });

  test("replaying an identical confirmation is idempotent", () => {
    expect(
      confirmDelivered(makeIntent(deliveredWithMessageState()), {
        attemptNonce: nonceA,
        messageId,
        deliveredAt,
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a differing confirmation on a delivered intent conflicts", () => {
    expectConflict(
      confirmDelivered(makeIntent(deliveredWithMessageState()), {
        attemptNonce: nonceA,
        messageId: otherMessageId,
        deliveredAt,
      }),
      "terminal-state",
    );
  });

  test("even a nonce-matching confirmation cannot leave unknown-delivery", () => {
    expectConflict(
      confirmDelivered(makeIntent(unknownDeliveryState()), {
        attemptNonce: nonceA,
        messageId,
        deliveredAt,
      }),
      "unknown-delivery-requires-operator",
    );
  });

  test.each(["pending", "ready"] as const)("%s conflicts", (kind) => {
    expectConflict(
      confirmDelivered(makeIntent({ kind }), {
        attemptNonce: nonceA,
        deliveredAt,
      }),
      "invalid-source-state",
    );
  });

  test.each(["suppressed", "expired", "permission-denied"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        confirmDelivered(makeIntent(statesByKind()[kind]), {
          attemptNonce: nonceA,
          deliveredAt,
        }),
        "terminal-state",
      );
    },
  );
});

describe("recordFailure", () => {
  test("a retryable failure returns the intent to ready", () => {
    const next = expectApplied(
      recordFailure(makeIntent(sendingState()), {
        attemptNonce: nonceA,
        failure: { classification: "retryable", reason: "rate-limited" },
      }),
    );
    expect(next.state).toEqual({ kind: "ready" });
    expect(next.lastFailure).toEqual({
      classification: "retryable",
      reason: "rate-limited",
    });
  });

  test("a terminal failure ends in permission-denied", () => {
    const next = expectApplied(
      recordFailure(makeIntent(sendingState()), {
        attemptNonce: nonceA,
        failure: { classification: "terminal", reason: "dm-disabled" },
      }),
    );
    expect(next.state).toEqual({ kind: "permission-denied" });
    expect(next.lastFailure).toEqual({
      classification: "terminal",
      reason: "dm-disabled",
    });
  });

  test("a stale worker's failure conflicts on nonce", () => {
    expectConflict(
      recordFailure(makeIntent(sendingState()), {
        attemptNonce: nonceB,
        failure: { classification: "retryable", reason: "network" },
      }),
      "attempt-nonce-mismatch",
    );
  });

  test.each(["pending", "ready"] as const)("%s conflicts", (kind) => {
    expectConflict(
      recordFailure(makeIntent({ kind }), {
        attemptNonce: nonceA,
        failure: { classification: "retryable", reason: "network" },
      }),
      "invalid-source-state",
    );
  });

  test("unknown-delivery requires the operator", () => {
    expectConflict(
      recordFailure(makeIntent(unknownDeliveryState()), {
        attemptNonce: nonceA,
        failure: { classification: "retryable", reason: "network" },
      }),
      "unknown-delivery-requires-operator",
    );
  });

  test.each(terminalIntents())("%s conflicts as terminal", (_kind, intent) => {
    expectConflict(
      recordFailure(intent, {
        attemptNonce: nonceA,
        failure: { classification: "terminal", reason: "dm-disabled" },
      }),
      "terminal-state",
    );
  });
});

describe("recordUnknownDelivery", () => {
  test("a nonce-matching unknown outcome is recorded", () => {
    const next = expectApplied(
      recordUnknownDelivery(makeIntent(sendingState()), {
        attemptNonce: nonceA,
        observedAt,
      }),
    );
    expect(next.state).toEqual(unknownDeliveryState());
  });

  test("a stale worker's observation conflicts on nonce", () => {
    expectConflict(
      recordUnknownDelivery(makeIntent(sendingState()), {
        attemptNonce: nonceB,
        observedAt,
      }),
      "attempt-nonce-mismatch",
    );
  });

  test("replaying the identical observation is idempotent", () => {
    expect(
      recordUnknownDelivery(makeIntent(unknownDeliveryState()), {
        attemptNonce: nonceA,
        observedAt,
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a differing observation on unknown-delivery requires the operator", () => {
    expectConflict(
      recordUnknownDelivery(makeIntent(unknownDeliveryState()), {
        attemptNonce: nonceB,
        observedAt,
      }),
      "unknown-delivery-requires-operator",
    );
  });

  test.each(["pending", "ready"] as const)("%s conflicts", (kind) => {
    expectConflict(
      recordUnknownDelivery(makeIntent({ kind }), {
        attemptNonce: nonceA,
        observedAt,
      }),
      "invalid-source-state",
    );
  });

  test.each(terminalIntents())("%s conflicts as terminal", (_kind, intent) => {
    expectConflict(
      recordUnknownDelivery(intent, { attemptNonce: nonceA, observedAt }),
      "terminal-state",
    );
  });
});

describe("suppressStale", () => {
  test.each(["pending", "ready"] as const)(
    "%s suppresses once the deadline has passed",
    (kind) => {
      const next = expectApplied(
        suppressStale(makeIntent({ kind }), { at: afterDeadline }),
      );
      expect(next.state).toEqual({ kind: "suppressed", reason: "stale" });
    },
  );

  test("staleness is compared by instant, not by string", () => {
    const next = expectApplied(
      suppressStale(makeIntent({ kind: "ready" }), {
        at: afterDeadlineWithOffset,
      }),
    );
    expect(next.state).toEqual({ kind: "suppressed", reason: "stale" });
  });

  test("suppressing at the exact deadline conflicts as not stale", () => {
    expectConflict(
      suppressStale(makeIntent({ kind: "ready" }), { at: exactDeadline }),
      "not-stale",
    );
  });

  test("suppressing before the deadline conflicts as not stale", () => {
    expectConflict(
      suppressStale(makeIntent({ kind: "pending" }), { at: beforeDeadline }),
      "not-stale",
    );
  });

  test("an in-flight send blocks suppression", () => {
    expectConflict(
      suppressStale(makeIntent(sendingState()), { at: afterDeadline }),
      "send-in-flight",
    );
  });

  test("unknown-delivery requires the operator", () => {
    expectConflict(
      suppressStale(makeIntent(unknownDeliveryState()), { at: afterDeadline }),
      "unknown-delivery-requires-operator",
    );
  });

  test("replaying a stale suppression is idempotent", () => {
    expect(
      suppressStale(makeIntent({ kind: "suppressed", reason: "stale" }), {
        at: afterDeadline,
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a differently-suppressed intent conflicts as terminal", () => {
    expectConflict(
      suppressStale(
        makeIntent({ kind: "suppressed", reason: "feature-disabled" }),
        { at: afterDeadline },
      ),
      "terminal-state",
    );
  });

  test.each(["delivered", "expired", "permission-denied"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        suppressStale(makeIntent(statesByKind()[kind]), { at: afterDeadline }),
        "terminal-state",
      );
    },
  );
});

describe("expire", () => {
  test.each(["pending", "ready"] as const)("%s expires", (kind) => {
    const next = expectApplied(expire(makeIntent({ kind })));
    expect(next.state).toEqual({ kind: "expired" });
  });

  test("an in-flight send blocks expiry", () => {
    expectConflict(expire(makeIntent(sendingState())), "send-in-flight");
  });

  test("unknown-delivery requires the operator", () => {
    expectConflict(
      expire(makeIntent(unknownDeliveryState())),
      "unknown-delivery-requires-operator",
    );
  });

  test("replaying expiry is idempotent", () => {
    expect(expire(makeIntent({ kind: "expired" }))).toEqual({
      outcome: "already-applied",
    });
  });

  test.each(["delivered", "suppressed", "permission-denied"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        expire(makeIntent(statesByKind()[kind])),
        "terminal-state",
      );
    },
  );
});

describe("operatorResolveUnknown", () => {
  test("resolving as delivered records the found message", () => {
    const next = expectApplied(
      operatorResolveUnknown(makeIntent(unknownDeliveryState()), {
        outcome: "delivered",
        messageId,
        deliveredAt,
      }),
    );
    expect(next.state).toEqual({ kind: "delivered", messageId, deliveredAt });
  });

  test("resolving as delivered works without a message id", () => {
    const next = expectApplied(
      operatorResolveUnknown(makeIntent(unknownDeliveryState()), {
        outcome: "delivered",
        deliveredAt,
      }),
    );
    expect(next.state).toEqual({ kind: "delivered", deliveredAt });
  });

  test("resolving as confirmed-unsent releases the intent to ready", () => {
    const next = expectApplied(
      operatorResolveUnknown(makeIntent(unknownDeliveryState()), {
        outcome: "confirmed-unsent",
      }),
    );
    expect(next.state).toEqual({ kind: "ready" });
    expect(next.attemptCount).toBe(0);
  });

  test("replaying an identical delivered resolution is idempotent", () => {
    expect(
      operatorResolveUnknown(makeIntent(deliveredWithMessageState()), {
        outcome: "delivered",
        messageId,
        deliveredAt,
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a differing delivered resolution conflicts as terminal", () => {
    expectConflict(
      operatorResolveUnknown(makeIntent(deliveredWithMessageState()), {
        outcome: "delivered",
        messageId: otherMessageId,
        deliveredAt,
      }),
      "terminal-state",
    );
  });

  test("a confirmed-unsent resolution on a delivered intent conflicts", () => {
    expectConflict(
      operatorResolveUnknown(makeIntent(deliveredWithMessageState()), {
        outcome: "confirmed-unsent",
      }),
      "terminal-state",
    );
  });

  test.each(["pending", "ready", "sending"] as const)(
    "%s conflicts",
    (kind) => {
      expectConflict(
        operatorResolveUnknown(makeIntent(statesByKind()[kind]), {
          outcome: "confirmed-unsent",
        }),
        "invalid-source-state",
      );
    },
  );

  test.each(["suppressed", "expired", "permission-denied"] as const)(
    "%s conflicts as terminal",
    (kind) => {
      expectConflict(
        operatorResolveUnknown(makeIntent(statesByKind()[kind]), {
          outcome: "confirmed-unsent",
        }),
        "terminal-state",
      );
    },
  );
});

describe("state-machine invariants", () => {
  const nonOperatorAttempts: readonly (readonly [
    string,
    (intent: NotificationIntent) => NotificationTransitionResult,
  ])[] = [
    ["markReady", (intent) => markReady(intent)],
    [
      "beginSend",
      (intent) =>
        beginSend(intent, { attemptNonce: nonceA, startedAt: beforeDeadline }),
    ],
    [
      "confirmDelivered (matching nonce)",
      (intent) =>
        confirmDelivered(intent, { attemptNonce: nonceA, deliveredAt }),
    ],
    [
      "recordFailure (matching nonce)",
      (intent) =>
        recordFailure(intent, {
          attemptNonce: nonceA,
          failure: { classification: "retryable", reason: "network" },
        }),
    ],
    [
      "recordUnknownDelivery (matching nonce)",
      (intent) =>
        recordUnknownDelivery(intent, { attemptNonce: nonceA, observedAt }),
    ],
    [
      "suppressStale (stale)",
      (intent) => suppressStale(intent, { at: afterDeadline }),
    ],
    ["expire", (intent) => expire(intent)],
  ];

  test.each(nonOperatorAttempts)(
    "unknown-delivery is never left by %s",
    (_name, attempt) => {
      const result = attempt(makeIntent(unknownDeliveryState()));
      expect(result.outcome).not.toBe("applied");
    },
  );

  const everyAttempt: readonly (readonly [
    string,
    (intent: NotificationIntent) => NotificationTransitionResult,
  ])[] = [
    ...nonOperatorAttempts,
    [
      "operatorResolveUnknown (delivered)",
      (intent) =>
        operatorResolveUnknown(intent, {
          outcome: "delivered",
          messageId,
          deliveredAt,
        }),
    ],
    [
      "operatorResolveUnknown (confirmed-unsent)",
      (intent) =>
        operatorResolveUnknown(intent, { outcome: "confirmed-unsent" }),
    ],
  ];

  test.each(
    terminalKinds.flatMap((kind) =>
      everyAttempt.map(
        (
          entry,
        ): readonly [
          (typeof terminalKinds)[number],
          string,
          (intent: NotificationIntent) => NotificationTransitionResult,
        ] => [kind, entry[0], entry[1]],
      ),
    ),
  )("terminal state %s is never left by %s", (kind, _name, attempt) => {
    const result = attempt(makeIntent(statesByKind()[kind]));
    expect(result.outcome).not.toBe("applied");
  });

  test.each(everyAttempt)("%s does not mutate its input", (_name, attempt) => {
    const intent = makeIntent(sendingState());
    const snapshot = structuredClone(intent);
    attempt(intent);
    expect(intent).toEqual(snapshot);
  });
});
