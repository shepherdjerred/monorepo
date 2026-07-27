import { describe, expect, it } from "bun:test";
import { WORKFLOW_TASK_POLLER_BEHAVIOR } from "./worker-options.ts";

describe("Temporal worker options", () => {
  it("uses a valid explicit workflow-task poller maximum with workflow caching", () => {
    expect(WORKFLOW_TASK_POLLER_BEHAVIOR).toEqual({
      type: "simple-maximum",
      maximum: 10,
    });
  });
});
