import { describe, expect, test } from "vitest";
import {
  activitySummary,
  timerSummary,
  WorkflowUiOutboundInterceptor,
} from "./workflow-ui-interceptor.ts";

describe("Workflow UI interceptor", () => {
  test("builds safe summaries without including activity arguments", () => {
    expect(activitySummary("fetchInitialHistoryPage")).toBe(
      "Run fetch initial history page activity",
    );
    expect(timerSummary(120_000)).toBe("Wait for 2 minute wait");
  });

  test("preserves an explicitly authored activity summary", async () => {
    const interceptor = new WorkflowUiOutboundInterceptor();
    const result = await interceptor.scheduleActivity?.(
      {
        activityType: "secretBearingActivity",
        args: [{ token: "must-not-appear" }],
        headers: {},
        seq: 1,
        options: {
          startToCloseTimeout: 1000,
          summary: "Safe explicit summary",
        },
      },
      async (input) => input.options.summary,
    );

    expect(result).toBe("Safe explicit summary");
  });
});
