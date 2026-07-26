import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, mock } from "bun:test";
import { BabysitVerdictSchema } from "#shared/pr-babysit/types.ts";
// Static namespace import resolves the real module before mock.module runs, so
// its other exports (babysitWorkdirPath, used by index.ts's cleanup) keep
// linking (see iteration.test.ts / agent-task.test.ts for this pattern).
import * as actualEnsureWorkdir from "./ensure-workdir.ts";
import * as actualEvaluateDod from "./evaluate-dod.ts";
import * as actualRuntime from "./runtime.ts";

// Canned DoD verdict the mocked evaluator returns (a still-broken open PR).
const VERDICT = BabysitVerdictSchema.parse({
  headSha: "deadbeef",
  prState: "open",
  ci: {
    green: false,
    failing: ["buildkite/monorepo/pr"],
    pending: [],
    ignoredSoft: [],
    noChecksReported: false,
    missingRequired: [],
  },
  conflicts: { clean: true, paths: [], baseRef: "main" },
  reviews: { allResolved: true, blocking: [], advisory: [] },
  dodMet: false,
  evaluatedAt: "2026-07-25T00:00:00.000Z",
});

// Record the order + workdir of the two collaborators so we can assert the
// wrapper ensures the workdir BEFORE evaluating, on every call.
const calls: { fn: "ensure" | "evaluate"; workdir?: string }[] = [];

// mintBabysitAuth: no real GitHub App token.
void mock.module("./runtime.ts", () => ({
  ...actualRuntime,
  mintBabysitAuth: () => Promise.resolve({ token: "test-token", env: {} }),
}));

// ensureBabysitWorkdir: create a REAL temp dir each call (so a caller that
// assumed persistence across calls would be caught) and record it.
void mock.module("./ensure-workdir.ts", () => ({
  ...actualEnsureWorkdir,
  ensureBabysitWorkdir: async (): Promise<{
    workdir: string;
    headSha: string;
  }> => {
    const workdir = await mkdtemp(
      path.join(os.tmpdir(), "babysit-assess-test-"),
    );
    calls.push({ fn: "ensure", workdir });
    return { workdir, headSha: "deadbeef" };
  },
}));

// evaluateBabysitDoD: record the workdir it was handed, return the canned verdict.
void mock.module("./evaluate-dod.ts", () => ({
  ...actualEvaluateDod,
  evaluateBabysitDoD: (input: { workdir: string }) => {
    calls.push({ fn: "evaluate", workdir: input.workdir });
    return Promise.resolve(VERDICT);
  },
}));

const assessInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 1616,
  headRef: "feature/test",
  baseRef: "main",
  workflowId: "pr-babysit-shepherdjerred-monorepo-1616",
  blockingSeverity: "P3" as const,
};

describe("assessBabysit is self-ensuring", () => {
  it("ensures before evaluating, and re-ensures after the workdir is wiped", async () => {
    // Import AFTER the mocks are registered so the wrapper links the fakes.
    const { prBabysitActivities } = await import("./index.ts");

    // First assess: ensure runs, then evaluate against exactly that workdir.
    const v1 = await prBabysitActivities.assessBabysit(assessInput);
    expect(v1.headSha).toBe("deadbeef");
    expect(calls.map((c) => c.fn)).toEqual(["ensure", "evaluate"]);
    const firstWorkdir = calls[0]?.workdir;
    expect(firstWorkdir).toBeDefined();
    expect(calls[1]?.workdir).toBe(firstWorkdir);

    // Simulate a worker restart wiping the pod-local workdir between calls.
    if (firstWorkdir !== undefined) {
      await rm(firstWorkdir, { recursive: true, force: true });
    }

    // Second assess MUST ensure again — the wrapper never assumes a prior
    // activity left the workdir on disk. This is the restart-safety regression
    // guard: before the fix, the workdir was created by a separate, already-
    // completed prepare activity that a Temporal retry would not re-run.
    const v2 = await prBabysitActivities.assessBabysit(assessInput);
    expect(v2.headSha).toBe("deadbeef");
    expect(calls.map((c) => c.fn)).toEqual([
      "ensure",
      "evaluate",
      "ensure",
      "evaluate",
    ]);
    const secondWorkdir = calls[2]?.workdir;
    expect(secondWorkdir).toBeDefined();
    expect(secondWorkdir).not.toBe(firstWorkdir);

    // The freshly ensured dir actually exists (proves re-creation, not reuse).
    if (secondWorkdir !== undefined) {
      const s = await stat(secondWorkdir);
      expect(s.isDirectory()).toBe(true);
      await rm(secondWorkdir, { recursive: true, force: true });
    }
  });
});
