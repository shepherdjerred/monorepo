import { describe, expect, test } from "bun:test";
import {
  classifyFleetFailure,
  validateProgressEvent,
} from "@shepherdjerred/pr-fleet-controller/src/progress-events.ts";

describe("fleet progress events", () => {
  test("classifies recurring worker failures into bounded reasons", () => {
    expect(
      classifyFleetFailure(
        new Error("Worktree setup must complete for the current head"),
      ),
    ).toBe("setup-required");
    expect(
      classifyFleetFailure(new Error("Invalid commit scope: design-audit")),
    ).toBe("invalid-commit-scope");
    expect(
      classifyFleetFailure(
        new Error("Operator worktree HEAD changed after assignment"),
      ),
    ).toBe("worktree-head-changed");
  });

  test("accepts normalized progress payloads and rejects malformed ones", () => {
    expect(() =>
      validateProgressEvent("publication.stage", {
        intent: "fix",
        stage: "submission",
        state: "completed",
      }),
    ).not.toThrow();
    expect(() =>
      validateProgressEvent("lease.denied", {
        kind: "setup",
        reason: "not-a-real-reason",
      }),
    ).toThrow();
  });
});
