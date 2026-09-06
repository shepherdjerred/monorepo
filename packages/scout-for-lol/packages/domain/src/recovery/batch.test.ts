import { describe, expect, test } from "vitest";
import {
  RecoveryAbandonReasonSchema,
  RecoveryBatchSchema,
  RecoveryBatchStateSchema,
  RecoveryCountsSchema,
  RecoveryPolicySchema,
  RecoveryScanCursorSchema,
} from "#src/recovery/batch.ts";
import { makeBatch, statesByKind } from "#src/recovery/batch.test-fixtures.ts";

describe("RecoveryPolicySchema", () => {
  test.each(["normal", "stale-private-only", "no-external"])(
    "accepts %s",
    (policy) => {
      expect(RecoveryPolicySchema.parse(policy)).toBe(policy);
    },
  );

  test("rejects policies outside the closed enum", () => {
    expect(() => RecoveryPolicySchema.parse("external-only")).toThrow();
  });
});

describe("RecoveryScanCursorSchema", () => {
  test("accepts a fresh cursor without a position", () => {
    const cursor = RecoveryScanCursorSchema.parse({
      pagesScanned: 0,
      pageBudget: 3,
    });
    expect(cursor).toEqual({ pagesScanned: 0, pageBudget: 3 });
  });

  test("accepts a cursor at its budget", () => {
    expect(
      RecoveryScanCursorSchema.parse({
        position: "page-3",
        pagesScanned: 3,
        pageBudget: 3,
      }).pagesScanned,
    ).toBe(3);
  });

  test("rejects a cursor past its budget", () => {
    expect(() =>
      RecoveryScanCursorSchema.parse({
        position: "page-4",
        pagesScanned: 4,
        pageBudget: 3,
      }),
    ).toThrow();
  });

  test("rejects an empty position token", () => {
    expect(() =>
      RecoveryScanCursorSchema.parse({
        position: "",
        pagesScanned: 1,
        pageBudget: 3,
      }),
    ).toThrow();
  });

  test("rejects a zero page budget", () => {
    expect(() =>
      RecoveryScanCursorSchema.parse({ pagesScanned: 0, pageBudget: 0 }),
    ).toThrow();
  });

  test("rejects fractional page counts", () => {
    expect(() =>
      RecoveryScanCursorSchema.parse({ pagesScanned: 0.5, pageBudget: 3 }),
    ).toThrow();
  });

  test("rejects an extra key", () => {
    expect(() =>
      RecoveryScanCursorSchema.parse({
        pagesScanned: 0,
        pageBudget: 3,
        resumed: true,
      }),
    ).toThrow();
  });
});

describe("RecoveryCountsSchema", () => {
  test("accepts fully accounted counts", () => {
    const counts = {
      discovered: 5,
      succeeded: 3,
      suppressed: 1,
      failed: 1,
    };
    expect(RecoveryCountsSchema.parse(counts)).toEqual(counts);
  });

  test("rejects counts whose processed total exceeds discovered", () => {
    expect(() =>
      RecoveryCountsSchema.parse({
        discovered: 2,
        succeeded: 2,
        suppressed: 1,
        failed: 0,
      }),
    ).toThrow();
  });

  test("rejects a negative count", () => {
    expect(() =>
      RecoveryCountsSchema.parse({
        discovered: 2,
        succeeded: -1,
        suppressed: 0,
        failed: 0,
      }),
    ).toThrow();
  });

  test("rejects a fractional count", () => {
    expect(() =>
      RecoveryCountsSchema.parse({
        discovered: 2.5,
        succeeded: 0,
        suppressed: 0,
        failed: 0,
      }),
    ).toThrow();
  });

  test("rejects an extra key", () => {
    expect(() =>
      RecoveryCountsSchema.parse({
        discovered: 2,
        succeeded: 0,
        suppressed: 0,
        failed: 0,
        skipped: 0,
      }),
    ).toThrow();
  });
});

describe("RecoveryAbandonReasonSchema", () => {
  test.each([
    "operator-cancelled",
    "scan-budget-exhausted",
    "upstream-unavailable",
    "superseded",
  ])("accepts %s", (reason) => {
    expect(RecoveryAbandonReasonSchema.parse(reason)).toBe(reason);
  });

  test("rejects reasons outside the closed enum", () => {
    expect(() => RecoveryAbandonReasonSchema.parse("bored")).toThrow();
  });
});

describe("RecoveryBatchStateSchema", () => {
  test.each(Object.entries(statesByKind()))(
    "round-trips the %s state",
    (kind, state) => {
      expect(RecoveryBatchStateSchema.parse(state)).toEqual(state);
      expect(state.kind).toBe(kind);
    },
  );

  test("rejects an unknown state kind", () => {
    expect(() => RecoveryBatchStateSchema.parse({ kind: "paused" })).toThrow();
  });

  test.each(Object.entries(statesByKind()))(
    "rejects the %s state with an extra key",
    (_kind, state) => {
      expect(() =>
        RecoveryBatchStateSchema.parse({ ...state, extra: true }),
      ).toThrow();
    },
  );

  test("rejects a scanning state without a cursor", () => {
    expect(() =>
      RecoveryBatchStateSchema.parse({ kind: "scanning" }),
    ).toThrow();
  });

  test("rejects an abandoned state without a reason", () => {
    expect(() =>
      RecoveryBatchStateSchema.parse({ kind: "abandoned" }),
    ).toThrow();
  });
});

describe("RecoveryBatchSchema", () => {
  test.each(Object.entries(statesByKind()))(
    "round-trips a batch in the %s state",
    (_kind, state) => {
      const batch = makeBatch(state);
      expect(RecoveryBatchSchema.parse(batch)).toEqual(batch);
    },
  );

  test.each(["normal", "stale-private-only", "no-external"] as const)(
    "round-trips a batch under the %s policy",
    (policy) => {
      const batch = makeBatch({ kind: "planned" }, policy);
      expect(RecoveryBatchSchema.parse(batch)).toEqual(batch);
    },
  );

  test("rejects an empty batch id", () => {
    expect(() =>
      RecoveryBatchSchema.parse({ ...makeBatch({ kind: "planned" }), id: "" }),
    ).toThrow();
  });

  test("rejects an extra top-level key", () => {
    expect(() =>
      RecoveryBatchSchema.parse({
        ...makeBatch({ kind: "planned" }),
        priority: "high",
      }),
    ).toThrow();
  });
});
