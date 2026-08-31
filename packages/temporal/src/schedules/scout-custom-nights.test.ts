import { describe, expect, test } from "vitest";
import { SCHEDULES } from "./schedule-definitions.ts";

describe("Scout custom-night expiry schedule", () => {
  test("runs only for beta through the embedded Scout workflow", () => {
    const beta = SCHEDULES.find(
      (schedule) => schedule.id === "scout-beta-custom-nights-expiry",
    );

    expect(beta).toMatchObject({
      workflowType: "scoutBackgroundJobWorkflow",
      args: [{ stage: "beta", kind: "custom-nights-expiry" }],
      taskQueue: "scout-beta",
      timing: { kind: "interval", every: "1 minute" },
    });
    expect(
      SCHEDULES.some(
        (schedule) => schedule.id === "scout-prod-custom-nights-expiry",
      ),
    ).toBe(false);
  });
});
