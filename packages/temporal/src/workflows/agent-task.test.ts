import { describe, expect, test } from "bun:test";
import { agentActivityRetryFor } from "./agent-task.ts";

describe("agentActivityRetryFor", () => {
  test("keeps the default retry policy for unbounded agent tasks", () => {
    expect(agentActivityRetryFor({})).toEqual({
      maximumAttempts: 2,
      initialInterval: "1 minute",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    });
  });

  test("uses a single attempt for bounded agent tasks", () => {
    expect(agentActivityRetryFor({ agentTimeoutMinutes: 8 })).toEqual({
      maximumAttempts: 1,
    });
  });
});
