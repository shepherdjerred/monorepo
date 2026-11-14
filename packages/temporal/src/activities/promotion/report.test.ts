import { MockActivityEnvironment } from "@temporalio/testing";
import { describe, expect, it } from "vitest";
import { initialPromotionState } from "#shared/promotion/model.ts";
import { ReportEnvelopeV1Schema } from "#shared/reports/report.ts";
import { promotionAlertFingerprint, promotionReport } from "./report.ts";

describe("promotion operator reports", () => {
  it("keeps reviewed budget allocations distinct from recorded charges and unknown exact usage", async () => {
    const environment = new MockActivityEnvironment();
    const result = await environment.run(() =>
      Promise.resolve(
        promotionReport([initialPromotionState("pmc", 900)], 0, undefined, {
          aiUsd: 0,
          allocatedAiUsd: 0.04877852,
          unknownAi: 1,
          unallocatedUnknownAi: 0,
        }),
      ),
    );
    const report = ReportEnvelopeV1Schema.parse(result);
    expect(report.headline).toContain(
      "$0.00000 recorded + $0.04878 reviewed budget allocation",
    );
    expect(report.headline).toContain("1 exact costs unknown (0 unallocated)");
  });
  it("reports uninspected targets as inconclusive instead of successfully verified", async () => {
    const environment = new MockActivityEnvironment();
    const result = await environment.run(() =>
      Promise.resolve(
        promotionReport([initialPromotionState("pmc", 900)], 10_000),
      ),
    );
    const report = ReportEnvelopeV1Schema.parse(result);
    expect(report.execution).toBe("partial");
    expect(report.verdict).toBe("inconclusive");
    expect(report.checks[0]?.status).toBe("skipped");
  });
  it("deduplicates an incident while allowing the same problem to alert in a later occurrence", () => {
    const state = {
      ...initialPromotionState("pmc", 900),
      blockedReason: "Login required",
      lastOccurrenceId: "first",
    };
    expect(promotionAlertFingerprint(state)).toBe(
      promotionAlertFingerprint({ ...state }),
    );
    expect(promotionAlertFingerprint(state)).not.toBe(
      promotionAlertFingerprint({ ...state, lastOccurrenceId: "second" }),
    );
  });
});
