import { describe, expect, test } from "vitest";
import {
  NotificationAttemptNonceSchema,
  NotificationFailureSchema,
  NotificationIntentSchema,
  NotificationIntentStateSchema,
  NotificationSuppressionReasonSchema,
  NotificationTargetSchema,
  OperatorUnknownResolutionSchema,
} from "#src/notifications/intent.ts";
import {
  makeIntent,
  statesByKind,
} from "#src/notifications/intent.test-fixtures.ts";

const validChannelTarget = {
  kind: "channel",
  channelId: "123456789012345678",
};
const validDmTarget = { kind: "dm", accountId: "876543210987654321" };

describe("NotificationTargetSchema", () => {
  test("accepts a channel target", () => {
    expect(NotificationTargetSchema.parse(validChannelTarget).kind).toBe(
      "channel",
    );
  });

  test("accepts a dm target", () => {
    expect(NotificationTargetSchema.parse(validDmTarget).kind).toBe("dm");
  });

  test("rejects an unknown target kind", () => {
    expect(() =>
      NotificationTargetSchema.parse({ kind: "webhook", url: "x" }),
    ).toThrow();
  });

  test("rejects a malformed channel id", () => {
    expect(() =>
      NotificationTargetSchema.parse({ kind: "channel", channelId: "abc" }),
    ).toThrow();
  });

  test("rejects a channel target carrying dm fields", () => {
    expect(() =>
      NotificationTargetSchema.parse({
        ...validChannelTarget,
        accountId: "876543210987654321",
      }),
    ).toThrow();
  });
});

describe("NotificationAttemptNonceSchema", () => {
  test("rejects the empty string", () => {
    expect(() => NotificationAttemptNonceSchema.parse("")).toThrow();
  });

  test("accepts any non-empty string", () => {
    expect(NotificationAttemptNonceSchema.parse("wf-run-1:attempt-2")).toBe(
      "wf-run-1:attempt-2",
    );
  });
});

describe("NotificationSuppressionReasonSchema", () => {
  test.each(["stale", "feature-disabled", "recipient-preference"])(
    "accepts %s",
    (reason) => {
      expect(NotificationSuppressionReasonSchema.parse(reason)).toBe(reason);
    },
  );

  test("rejects reasons outside the closed enum", () => {
    expect(() =>
      NotificationSuppressionReasonSchema.parse("operator-whim"),
    ).toThrow();
  });
});

describe("NotificationFailureSchema", () => {
  test("accepts a retryable failure with a retryable reason", () => {
    expect(
      NotificationFailureSchema.parse({
        classification: "retryable",
        reason: "rate-limited",
      }).classification,
    ).toBe("retryable");
  });

  test("accepts a terminal failure with a terminal reason", () => {
    expect(
      NotificationFailureSchema.parse({
        classification: "terminal",
        reason: "dm-disabled",
      }).classification,
    ).toBe("terminal");
  });

  test("rejects a retryable failure with a terminal reason", () => {
    expect(() =>
      NotificationFailureSchema.parse({
        classification: "retryable",
        reason: "dm-disabled",
      }),
    ).toThrow();
  });

  test("rejects a terminal failure with a retryable reason", () => {
    expect(() =>
      NotificationFailureSchema.parse({
        classification: "terminal",
        reason: "timeout",
      }),
    ).toThrow();
  });
});

describe("NotificationIntentStateSchema", () => {
  test.each(Object.entries(statesByKind()))(
    "round-trips the %s state",
    (kind, state) => {
      expect(NotificationIntentStateSchema.parse(state)).toEqual(state);
      expect(state.kind).toBe(kind);
    },
  );

  test("rejects an unknown state kind", () => {
    expect(() =>
      NotificationIntentStateSchema.parse({ kind: "retrying" }),
    ).toThrow();
  });

  test.each(Object.entries(statesByKind()))(
    "rejects the %s state with an extra key",
    (_kind, state) => {
      expect(() =>
        NotificationIntentStateSchema.parse({ ...state, extra: true }),
      ).toThrow();
    },
  );

  test("rejects a sending state missing its nonce", () => {
    expect(() =>
      NotificationIntentStateSchema.parse({
        kind: "sending",
        startedAt: "2026-09-01T12:30:00.000Z",
      }),
    ).toThrow();
  });

  test("accepts a delivered state without a message id", () => {
    const state = NotificationIntentStateSchema.parse({
      kind: "delivered",
      deliveredAt: "2026-09-01T12:31:00.000Z",
    });
    expect(state).toEqual({
      kind: "delivered",
      deliveredAt: "2026-09-01T12:31:00.000Z",
    });
  });
});

describe("OperatorUnknownResolutionSchema", () => {
  test("accepts a delivered resolution naming its attempt", () => {
    expect(
      OperatorUnknownResolutionSchema.parse({
        outcome: "delivered",
        attemptNonce: "attempt-nonce-a",
        deliveredAt: "2026-09-01T12:31:00.000Z",
      }).outcome,
    ).toBe("delivered");
  });

  test("accepts a confirmed-unsent resolution naming its attempt", () => {
    expect(
      OperatorUnknownResolutionSchema.parse({
        outcome: "confirmed-unsent",
        attemptNonce: "attempt-nonce-a",
      }).outcome,
    ).toBe("confirmed-unsent");
  });

  test.each(["delivered", "confirmed-unsent"])(
    "rejects a %s resolution without an attempt nonce",
    (outcome) => {
      expect(() =>
        OperatorUnknownResolutionSchema.parse({
          outcome,
          ...(outcome === "delivered"
            ? { deliveredAt: "2026-09-01T12:31:00.000Z" }
            : {}),
        }),
      ).toThrow();
    },
  );

  test("rejects a confirmed-unsent resolution carrying delivery fields", () => {
    expect(() =>
      OperatorUnknownResolutionSchema.parse({
        outcome: "confirmed-unsent",
        attemptNonce: "attempt-nonce-a",
        deliveredAt: "2026-09-01T12:31:00.000Z",
      }),
    ).toThrow();
  });
});

describe("NotificationIntentSchema", () => {
  test.each(Object.entries(statesByKind()))(
    "round-trips an intent in the %s state",
    (_kind, state) => {
      const intent = makeIntent(state);
      expect(NotificationIntentSchema.parse(intent)).toEqual(intent);
    },
  );

  test("rejects an intent with an unknown key shape", () => {
    expect(() =>
      NotificationIntentSchema.parse({
        ...makeIntent({ kind: "pending" }),
        key: "",
      }),
    ).toThrow();
  });

  test("rejects an extra top-level key", () => {
    expect(() =>
      NotificationIntentSchema.parse({
        ...makeIntent({ kind: "pending" }),
        priority: 1,
      }),
    ).toThrow();
  });

  test("rejects a negative attempt count", () => {
    expect(() =>
      NotificationIntentSchema.parse({
        ...makeIntent({ kind: "pending" }),
        attemptCount: -1,
      }),
    ).toThrow();
  });

  test("rejects a fractional attempt count", () => {
    expect(() =>
      NotificationIntentSchema.parse({
        ...makeIntent({ kind: "pending" }),
        attemptCount: 0.5,
      }),
    ).toThrow();
  });

  test.each(["sending", "unknown-delivery"] as const)(
    "rejects a %s intent that never began an attempt",
    (kind) => {
      expect(() =>
        NotificationIntentSchema.parse({
          ...makeIntent(statesByKind()[kind]),
          attemptCount: 0,
        }),
      ).toThrow();
    },
  );

  test("rejects a non-instant freshness deadline", () => {
    expect(() =>
      NotificationIntentSchema.parse({
        ...makeIntent({ kind: "pending" }),
        freshnessDeadline: "tomorrow",
      }),
    ).toThrow();
  });

  test("accepts a recorded last failure", () => {
    const intent = {
      ...makeIntent({ kind: "ready" }),
      lastFailure: { classification: "retryable", reason: "network" },
    };
    expect(NotificationIntentSchema.parse(intent)).toEqual(intent);
  });
});
