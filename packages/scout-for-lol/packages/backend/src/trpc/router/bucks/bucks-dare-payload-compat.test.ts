import { describe, expect, test } from "vitest";
import { DarePayloadInputSchema } from "#src/trpc/router/bucks/bucks-dare-action-procedures.ts";

/**
 * Covers the rollout shim that accepts the pre-rename dare action payload.
 * When the legacy branch is deleted a release from now, these cases go with it.
 */
describe("DarePayloadInputSchema", () => {
  test("accepts the current kind-discriminated shape unchanged", () => {
    expect(DarePayloadInputSchema.parse({ kind: "dare_fund" })).toEqual({
      kind: "dare_fund",
    });
    expect(
      DarePayloadInputSchema.parse({ kind: "dare_contribute", amount: 7 }),
    ).toEqual({ kind: "dare_contribute", amount: 7 });
  });

  test("normalizes a payload from a tab loaded before the rename", () => {
    // Rejecting this would take every Dare action in that tab out of service
    // until the user happened to reload.
    expect(DarePayloadInputSchema.parse({ action: "fund" })).toEqual({
      kind: "dare_fund",
    });
    expect(DarePayloadInputSchema.parse({ action: "cancel" })).toEqual({
      kind: "dare_cancel",
    });
    expect(
      DarePayloadInputSchema.parse({ action: "contribute", amount: 3 }),
    ).toEqual({ kind: "dare_contribute", amount: 3 });
  });

  test("rejects an over-Int32 contribution in either form", () => {
    // The money brands no longer carry the Int32 bound, so the payload
    // schemas name the storable stake explicitly. Losing that here would let
    // a value the `Int` column cannot hold reach the intent table.
    const overInt32 = 2_147_483_648;
    expect(
      DarePayloadInputSchema.safeParse({
        kind: "dare_contribute",
        amount: overInt32,
      }).success,
    ).toBe(false);
    expect(
      DarePayloadInputSchema.safeParse({
        action: "contribute",
        amount: overInt32,
      }).success,
    ).toBe(false);
  });

  test("reports a rejected legacy payload as a failed branch, never a throw", () => {
    // The legacy branch re-parses through `DareIntentPayloadSchema` inside a
    // transform. A transform that threw would escape the enclosing union and
    // surface as a 500 rather than a validation error, so every rejection has
    // to come back through `safeParse`.
    for (const malformed of [
      { action: "contribute", amount: 0 },
      { action: "contribute", amount: 1.5 },
      { action: "contribute", amount: "seven" },
      { action: "contribute", amount: 2_147_483_648 },
    ]) {
      expect(DarePayloadInputSchema.safeParse(malformed).success).toBe(false);
    }
  });

  test("still rejects shapes that are neither form", () => {
    expect(() =>
      DarePayloadInputSchema.parse({ action: "nonsense" }),
    ).toThrow();
    expect(() =>
      DarePayloadInputSchema.parse({ kind: "dare_fund", extra: 1 }),
    ).toThrow();
    // A contribution must carry its amount in either form.
    expect(() =>
      DarePayloadInputSchema.parse({ action: "contribute" }),
    ).toThrow();
  });
});
