import { describe, expect, test } from "vitest";
import { darePollHealth } from "#src/betting/dares/evaluation/dare-poll-health.ts";

const NOW = new Date("2026-09-03T00:05:00.000Z");

describe("Dare poll health", () => {
  test("marks a started but unfinished poll as delayed", () => {
    expect(
      darePollHealth(
        {
          lastSuccessfulPollAt: null,
          pollStartedAt: new Date("2026-09-03T00:04:30.000Z"),
          pollCompletedAt: null,
          evidenceWatermarkAt: null,
          pollEvidenceComplete: null,
          pollFailureReason: null,
          pollStatus: "running",
        },
        NOW,
      ),
    ).toMatchObject({ status: "delayed" });
  });

  test("marks a healthy poll older than two cadences as stale", () => {
    expect(
      darePollHealth(
        {
          lastSuccessfulPollAt: new Date("2026-09-03T00:02:00.000Z"),
          pollStartedAt: new Date("2026-09-03T00:01:30.000Z"),
          pollCompletedAt: new Date("2026-09-03T00:02:00.000Z"),
          evidenceWatermarkAt: new Date("2026-09-03T00:01:30.000Z"),
          pollEvidenceComplete: true,
          pollFailureReason: null,
          pollStatus: "healthy",
        },
        NOW,
      ),
    ).toMatchObject({ status: "stale" });
  });
});
