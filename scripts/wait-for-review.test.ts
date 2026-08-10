import { describe, expect, test } from "bun:test";
import { resolveReviewGateProvider } from "./wait-for-review.ts";

describe("resolveReviewGateProvider", () => {
  test("pins the required CI gate to Qodo", () => {
    expect(resolveReviewGateProvider(undefined).id).toBe("qodo");
    expect(resolveReviewGateProvider("").id).toBe("qodo");
    expect(resolveReviewGateProvider("  QODO ").id).toBe("qodo");
  });

  test("rejects registered non-CI providers", () => {
    expect(() => resolveReviewGateProvider("codex")).toThrow(
      "CI review gate requires Qodo",
    );
    expect(() => resolveReviewGateProvider("greptile")).toThrow(
      "CI review gate requires Qodo",
    );
  });
});
