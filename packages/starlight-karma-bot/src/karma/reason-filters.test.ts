import { describe, expect, test } from "vitest";
import {
  humanReasonFilter,
  SYNTHETIC_LEGACY_REASON,
} from "./reason-filters.ts";

describe("humanReasonFilter", () => {
  test("requires a positive human reason without reaction provenance", () => {
    expect(humanReasonFilter()).toEqual({
      amount: { gt: 0 },
      sourceMessageId: null,
      reason: { not: null },
      NOT: { reason: SYNTHETIC_LEGACY_REASON },
    });
  });
});
