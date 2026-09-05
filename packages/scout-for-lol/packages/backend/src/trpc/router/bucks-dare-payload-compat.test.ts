import { describe, expect, test } from "vitest";
import { DarePayloadInputSchema } from "#src/trpc/router/bucks-dare-action-procedures.ts";

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
