import { describe, expect, test } from "bun:test";
import {
  OperatorInputRequestSchema,
  PrStateSchema,
  WorkerResultSchema,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { ConventionalCommitMessageSchema } from "@shepherdjerred/pr-fleet-controller/src/tools.ts";
import {
  boundedInheritedCommitEvidence,
  requireCompleteInheritedCommitInspection,
} from "@shepherdjerred/pr-fleet-controller/src/worker-wip-tools.ts";
import { evidence, identity } from "./fixtures.ts";

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

  test("marks oversized inherited commit evidence incomplete and blocks publication", () => {
    const complete = boundedInheritedCommitEvidence(
      "commit abc\nM\tpackages/x.ts",
      "diff --git a/packages/x.ts b/packages/x.ts",
    );
    expect(complete.complete).toBe(true);
    expect(complete.evidence).toContain("Complete patch");

    const truncated = boundedInheritedCommitEvidence(
      "commit abc",
      "x".repeat(110_000),
    );
    expect(truncated.complete).toBe(false);
    expect(truncated.evidence).toContain("publication is disabled");

    const pr = identity(43);
    const state = PrStateSchema.parse({
      identity: pr,
      logicalOwner: "pr-43",
      runtimeAgent: "pr-43-g1",
      agentGeneration: 1,
      model: "openai/gpt-5.6-terra",
      status: "diagnosing",
      classification: "actionable-red",
      stackId: "pr-43",
      worktree: "/tmp/worktrees/pr-43",
      worktreeContext: {
        ownership: "operator",
        remoteHeadSha: pr.headSha,
        localHeadSha: "b".repeat(40),
        relation: "ahead",
        dirty: false,
        stagedPaths: [],
        unstagedPaths: [],
      },
      setupComplete: true,
      evidence: evidence(pr),
      lastAgentReportAt: null,
      lastProgressAt: "2026-08-08T20:00:00.000Z",
      noProgressTicks: 0,
      prodSentAt: null,
      escalation: null,
      priority: 0,
    });
    const store = new FleetStore(1);
    store.inheritedCommitInspections.set(pr.number, {
      remoteHeadSha: pr.headSha,
      localHeadSha: "b".repeat(40),
      complete: false,
    });
    expect(() =>
      requireCompleteInheritedCommitInspection(store, state, "b".repeat(40)),
    ).toThrow(/complete current-head/);

    store.inheritedCommitInspections.set(pr.number, {
      remoteHeadSha: pr.headSha,
      localHeadSha: "b".repeat(40),
      complete: true,
    });
    expect(() =>
      requireCompleteInheritedCommitInspection(store, state, "b".repeat(40)),
    ).not.toThrow();
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
