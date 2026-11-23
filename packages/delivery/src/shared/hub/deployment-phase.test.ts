import { describe, expect, it } from "vitest";
import { attemptPhase } from "./deployment-phase.ts";

describe("attemptPhase", () => {
  it("says deploying only once an executor has claimed the deployment", () => {
    expect(attemptPhase("running")).toBe("deploying");
    expect(attemptPhase("queued")).toBe("queued");
    expect(attemptPhase("pending")).toBe("queued");
  });

  it("has no phase for a status that is not an unfinished attempt", () => {
    for (const status of [
      "succeeded",
      "failed",
      "canceled",
      "awaiting_approval",
      "not_started",
    ])
      expect(attemptPhase(status)).toBeNull();
  });
});
