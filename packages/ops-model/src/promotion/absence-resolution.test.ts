import { describe, expect, it } from "vitest";
import { PromotionAbsenceResolutionSchema } from "./absence-resolution.ts";

describe("absence resolution request schema", () => {
  const request = {
    operation: "resolve-absence",
    namespace: "prod",
    targetId: "fixture",
    resolutionId: "00000000-0000-4000-8000-000000000003",
    evidenceSha256: "a".repeat(64),
    evidenceJson: "{}",
    apply: false,
  };
  it("requires an explicit reviewed ETag for apply and rejects other namespaces", () => {
    expect(PromotionAbsenceResolutionSchema.safeParse(request).success).toBe(
      true,
    );
    expect(
      PromotionAbsenceResolutionSchema.safeParse({ ...request, apply: true })
        .success,
    ).toBe(false);
    expect(
      PromotionAbsenceResolutionSchema.safeParse({
        ...request,
        apply: true,
        expectedStateEtag: '"reviewed"',
      }).success,
    ).toBe(true);
    expect(
      PromotionAbsenceResolutionSchema.safeParse({
        ...request,
        namespace: "beta",
      }).success,
    ).toBe(false);
  });
  it("excludes raw pages, oversized evidence, ambiguous IDs and unrecognized keys", () => {
    for (const change of [
      { evidenceJson: "x".repeat(16_385) },
      { targetId: "../all" },
      { resolutionId: "unknown" },
      { screenshot: "private-bytes" },
    ]) {
      expect(
        PromotionAbsenceResolutionSchema.safeParse({ ...request, ...change })
          .success,
      ).toBe(false);
    }
  });
});
