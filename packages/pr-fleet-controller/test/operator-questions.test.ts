import { describe, expect, test } from "bun:test";
import {
  OperatorInputRequestSchema,
  WorkerResultSchema,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { ConventionalCommitMessageSchema } from "@shepherdjerred/pr-fleet-controller/src/tools.ts";

function requestWithRecommendations(recommendations: boolean[]) {
  return {
    id: "request-1",
    pr: 42,
    headSha: "a".repeat(40),
    generation: 1,
    context: "Two valid fixes have materially different ownership effects.",
    questions: [
      {
        id: "fix",
        header: "Choose fix",
        question: "Which fix reflects the intended behavior?",
        options: recommendations.map((recommended, index) => ({
          id: `option-${String(index)}`,
          label: `Option ${String(index)}`,
          description: `Evidence for option ${String(index)}`,
          recommended,
        })),
      },
    ],
    createdAt: "2026-08-08T20:00:00.000Z",
  };
}

describe("operator question contracts", () => {
  test("accepts conventional commit messages used by workers", () => {
    expect(
      ConventionalCommitMessageSchema.safeParse(
        "fix(pr-fleet): preserve inherited commits",
      ).success,
    ).toBe(true);
    expect(
      ConventionalCommitMessageSchema.safeParse(
        "fix: preserve inherited commits",
      ).success,
    ).toBe(true);
    expect(
      ConventionalCommitMessageSchema.safeParse(
        "feat(pr-fleet)!: change the operator protocol",
      ).success,
    ).toBe(true);
    expect(
      ConventionalCommitMessageSchema.safeParse("preserve inherited commits")
        .success,
    ).toBe(false);
  });

  test("requires two or three choices with exactly one recommendation", () => {
    expect(
      OperatorInputRequestSchema.safeParse(
        requestWithRecommendations([true, false]),
      ).success,
    ).toBe(true);
    expect(
      OperatorInputRequestSchema.safeParse(
        requestWithRecommendations([false, false]),
      ).success,
    ).toBe(false);
    expect(
      OperatorInputRequestSchema.safeParse(
        requestWithRecommendations([true, true]),
      ).success,
    ).toBe(false);
    expect(
      OperatorInputRequestSchema.safeParse(requestWithRecommendations([true]))
        .success,
    ).toBe(false);
  });

  test("binds waiting worker results to a persisted request ID", () => {
    const base = {
      pr: 42,
      headShaBefore: "a".repeat(40),
      headShaAfter: null,
      hardFailures: [],
      reviewFindings: [],
      conflict: false,
      validation: [],
      lastAction: "asked operator",
      blockers: [],
      worktree: "/tmp/worktree",
      worktreeDirty: false,
      setupLeaseReleased: true,
      heavyLeaseReleased: true,
      writeLeaseReleased: true,
    };
    expect(
      WorkerResultSchema.safeParse({
        ...base,
        state: "waiting-for-answer",
        operatorRequestId: "request-1",
      }).success,
    ).toBe(true);
    expect(
      WorkerResultSchema.safeParse({
        ...base,
        state: "waiting-for-answer",
      }).success,
    ).toBe(false);
    expect(
      WorkerResultSchema.safeParse({
        ...base,
        state: "waiting-ci",
        operatorRequestId: "request-1",
      }).success,
    ).toBe(false);
  });
});
