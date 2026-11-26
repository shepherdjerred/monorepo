import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import {
  ConfigSchema,
  TaskStateSchema,
  type TrackerIssue,
  type TaskState,
} from "#src/domain/schemas.ts";
import {
  fakeTrackerRunner,
  recordedLabelMutations,
} from "#src/integrations/fake-tracker.ts";
import { TrackerClient } from "#src/integrations/tracker.ts";
import {
  completeTask,
  mergeTask,
  pauseTask,
  queueUnhealthy,
  restackStaleMergeTask,
} from "#src/reconcile-merge.ts";
import { AutonomousBlocker } from "#src/domain/autonomy.ts";
import { DeliveryAuthorization } from "#src/host/delivery-authorization.ts";
import { GitWorkspace } from "#src/host/git-workspace.ts";
import { GitHubClient } from "#src/integrations/github.ts";
import type { PullRequest } from "#src/integrations/github-pull-request.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { JustinTelemetry } from "#src/runtime/telemetry.ts";

function state(): TaskState {
  const issue: TrackerIssue = {
    id: "node-1",
    identifier: "SJ-1",
    title: "XX-1",
    description: null,
    url: "https://tracker.tailnet-1a49.ts.net/issues/XX-1",
    priority: 0,
    team: { key: "SJ" },
    createdAt: "2026-01-01T00:00:00.000Z",
    state: { name: "In Progress", type: "started" },
    labels: { nodes: [{ name: "agent:codex" }] },
  };
  return TaskStateSchema.parse({
    issue,
    provider: "codex",
    phase: "implementing",
    resumePhase: null,
    branch: "agent/xx-1",
    checkoutPath: "/tmp/xx-1",
    prNumber: null,
    prUrl: null,
    latestHeadSha: null,
    lastAgentOutput: null,
    pendingFeedback: [],
    pendingHealth: null,
    pendingDiagnostics: null,
    pendingCodexFindingKeys: [],
    restackInProgress: false,
    evidencePublished: false,
    evidenceMarkdown: [],
    seenFeedbackIds: [],
    failureCount: 2,
    lastFailureFingerprint: "abc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("pauseTask", () => {
  test("saves needs_human after the label lands", async () => {
    const saved: TaskState[] = [];
    const tracker = new TrackerClient("SJ", fakeTrackerRunner());
    await pauseTask({
      state: state(),
      reason: "reason",
      tracker,
      store: {
        save: (next: TaskState): Promise<void> => {
          saved.push(next);
          return Promise.resolve();
        },
      },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.phase).toBe("needs_human");
    expect(saved[0]?.resumePhase).toBe("implementing");
  });

  test("leaves runnable state when the label mutation fails", async () => {
    const saved: TaskState[] = [];
    const tracker = new TrackerClient(
      "SJ",
      fakeTrackerRunner([], { mutateSuccess: false }),
    );
    await expect(
      pauseTask({
        state: state(),
        reason: "reason",
        tracker,
        store: {
          save: (next: TaskState): Promise<void> => {
            saved.push(next);
            return Promise.resolve();
          },
        },
      }),
    ).rejects.toThrow(/label mutation failed/);
    expect(saved).toEqual([]);
  });

  test("rolls the label back when the save fails", async () => {
    const calls: string[][] = [];
    const tracker = new TrackerClient("SJ", fakeTrackerRunner(calls));
    await expect(
      pauseTask({
        state: state(),
        reason: "reason",
        tracker,
        store: {
          save: (): Promise<void> => Promise.reject(new Error("disk is full")),
        },
      }),
    ).rejects.toThrow(/disk is full/);
    const mutations = recordedLabelMutations(calls);
    expect(mutations).toHaveLength(2);
    const variables = mutations;
    expect(variables[0]).toEqual({
      id: "SJ-1",
      add: ["agent:needs-human"],
      remove: [],
    });
    expect(variables[1]).toEqual({
      id: "SJ-1",
      add: [],
      remove: ["agent:needs-human"],
    });
  });
});

function saveStub(saved: TaskState[]) {
  return (
    current: TaskState,
    phase: TaskState["phase"],
    patch: Partial<TaskState> = {},
  ): Promise<TaskState> => {
    const next: TaskState = { ...current, ...patch, phase };
    saved.push(next);
    return Promise.resolve(next);
  };
}

function commentBodies(calls: string[][]): string[] {
  return calls
    .filter(
      (args) =>
        args[2] === "issue" && args[3] === "comment" && args[4] === "add",
    )
    .map((args) => args[args.indexOf("--body") + 1] ?? "");
}

function infoCollector(messages: string[]) {
  return (message: string): void => {
    messages.push(message);
  };
}

describe("review provider outages", () => {
  test.each([
    {
      failures: [
        'Workflow "codex-review-gate" - FAILURE',
        'Workflow "ci-complete" - FAILURE',
      ],
      retryableBlock: true,
    },
    {
      failures: [
        'Workflow "codex-review-gate" - FAILURE',
        'Workflow "verify" - FAILURE',
        'Workflow "ci-complete" - FAILURE',
      ],
      retryableBlock: false,
    },
    {
      failures: [
        'Workflow "codex-review-gate" - FAILURE',
        'GitHub check "external-test" - FAILURE',
      ],
      retryableBlock: false,
    },
    {
      failures: ['GitHub check "ci/code-review" - FAILURE'],
      retryableBlock: true,
    },
    {
      failures: ['GitHub check "ci/code-review" - ERROR'],
      retryableBlock: true,
    },
    {
      failures: [
        'GitHub check "ci/code-review" - FAILURE',
        'GitHub check "external-test" - PENDING',
      ],
      retryableBlock: true,
    },
    {
      failures: [
        'GitHub check "ci/code-review" - FAILURE',
        'Workflow "verify" - FAILURE',
      ],
      retryableBlock: false,
    },
    {
      failures: [
        'GitHub check "ci/code-review" - FAILURE',
        'GitHub check "external-test" - FAILURE',
      ],
      retryableBlock: false,
    },
  ])("classifies $failures", async ({ failures, retryableBlock }) => {
    const github = new GitHubClient(
      "owner/repo",
      {
        approver: { login: "owner", id: 1 },
        expectedBotLogin: "app/justin-principal-engineer",
      },
      fakeTrackerRunner(),
      {},
    );
    vi.spyOn(github, "failureDiagnostics").mockResolvedValue("CI logs");
    vi.spyOn(github, "reviewDiagnostics").mockResolvedValue({
      text: "Providers unavailable",
      findings: [],
      blockedReasons: ["codex: usage-limited", "coderabbit: missing-bot-seat"],
    });
    const saved: TaskState[] = [];
    const pr: PullRequest = {
      number: 7,
      url: "https://example.com/pr/7",
      headRefOid: "a".repeat(40),
      headRefName: "agent/xx-1",
      baseRefName: "main",
      isDraft: false,
      state: "OPEN",
      mergedAt: null,
      mergeCommit: null,
      author: { login: "app/justin-principal-engineer", is_bot: true },
    };
    const operation = queueUnhealthy({
      state: { ...state(), deliveryMode: "autonomous" },
      pr,
      health: {
        prNumber: pr.number,
        prUrl: pr.url,
        overallStatus: "UNHEALTHY",
        nextSteps: [],
        checks: [
          { name: "Merge Conflicts", status: "HEALTHY", details: [] },
          { name: "CI Status", status: "UNHEALTHY", details: failures },
        ],
      },
      save: saveStub(saved),
      withGitHub: (work) => work(github, {}),
    });
    if (retryableBlock) {
      await expect(operation).rejects.toBeInstanceOf(AutonomousBlocker);
      await expect(operation).rejects.toMatchObject({ retryable: true });
      expect(saved).toEqual([]);
    } else {
      await expect(operation).resolves.toBe(true);
      expect(saved.map(({ phase }) => phase)).toEqual(["implementing"]);
    }
  });
});

describe("completeTask", () => {
  test("completes the merge path and saves done", async () => {
    const calls: string[][] = [];
    const saved: TaskState[] = [];
    const tracker = new TrackerClient("SJ", fakeTrackerRunner(calls));
    const messages: string[] = [];
    await completeTask({
      state: {
        ...state(),
        phase: "completing",
        prNumber: 7,
        prUrl: "https://example.com/pr/7",
        mergeCommitSha: "a".repeat(40),
      },
      tracker,
      save: saveStub(saved),
      writeInfo: (message: string) => {
        messages.push(message);
      },
    });
    const mutations = recordedLabelMutations(calls);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toEqual({
      id: "SJ-1",
      add: [],
      remove: ["agent:codex"],
    });
    expect(saved.map(({ phase }) => phase)).toEqual(["done"]);
    expect(saved[0]?.resumePhase).toBeNull();
    expect(messages).toEqual(["SJ-1: merged https://example.com/pr/7"]);
  });

  test("completes the no-change path without a PR", async () => {
    const calls: string[][] = [];
    const saved: TaskState[] = [];
    const messages: string[] = [];
    const tracker = new TrackerClient("SJ", fakeTrackerRunner(calls));
    await completeTask({
      state: { ...state(), phase: "completing" },
      tracker,
      save: saveStub(saved),
      writeInfo: infoCollector(messages),
    });
    expect(commentBodies(calls)).toEqual([
      "No change needed; the requested state was already present.",
    ]);
    expect(saved.map(({ phase }) => phase)).toEqual(["done"]);
    expect(messages).toEqual(["SJ-1: no change was needed; issue completed"]);
  });

  test("a failed cleanup never reaches done", async () => {
    const saved: TaskState[] = [];
    const messages: string[] = [];
    const tracker = new TrackerClient(
      "SJ",
      fakeTrackerRunner([], { mutateSuccess: false }),
    );
    await expect(
      completeTask({
        state: {
          ...state(),
          phase: "completing",
          prNumber: 7,
          prUrl: "https://example.com/pr/7",
          mergeCommitSha: "a".repeat(40),
        },
        tracker,
        save: saveStub(saved),
        writeInfo: infoCollector(messages),
      }),
    ).rejects.toThrow(/label mutation failed/);
    expect(saved).toEqual([]);
    expect(messages).toEqual([]);
  });
});

describe("merge-time stale-base restack and DeliveryAuthorization.mergeReady", () => {
  test("mergeReady refuses staleBase.stale === true and accepts disjoint_clean", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "jpe-stale-auth-"));
    try {
      const paths = runtimePaths(home);
      const config = ConfigSchema.parse(
        await Bun.file(
          path.join(import.meta.dirname, "../config.example.json"),
        ).json(),
      );
      const runner = fakeTrackerRunner();
      const github = new GitHubClient(
        "owner/repo",
        {
          approver: { login: "owner", id: 1 },
          expectedBotLogin: "app/justin-principal-engineer",
        },
        runner,
        {},
      );
      const head = "a".repeat(40);
      const pr: PullRequest = {
        number: 7,
        url: "https://example.com/pr/7",
        headRefOid: head,
        headRefName: "agent/xx-1",
        baseRefName: "main",
        isDraft: false,
        state: "OPEN",
        mergedAt: null,
        mergeCommit: null,
        author: { login: "app/justin-principal-engineer", is_bot: true },
      };
      vi.spyOn(github, "pullRequest").mockResolvedValue(pr);
      vi.spyOn(github, "hasExactHeadApproval").mockResolvedValue(true);
      vi.spyOn(github, "feedback").mockResolvedValue([]);
      const git = new GitWorkspace(config, runner);
      vi.spyOn(git, "headSha").mockResolvedValue(head);

      const healthSpy = vi.spyOn(github, "health").mockResolvedValue({
        prNumber: 7,
        prUrl: pr.url,
        overallStatus: "HEALTHY",
        nextSteps: [],
        checks: [
          { name: "Merge Conflicts", status: "HEALTHY", details: [] },
          { name: "CI Status", status: "HEALTHY", details: [] },
        ],
        staleBase: {
          stale: true,
          headSha: head,
          mergeBaseSha: "b".repeat(40),
          mainHeadSha: "c".repeat(40),
          behindBy: 2,
          verdict: "stale_overlap",
          reasons: ["main modified bun.lock"],
        },
      });

      const auth = new DeliveryAuthorization({
        config,
        paths,
        tracker: new TrackerClient("SJ", runner),
        git,
        run: runner,
        withGitHub: (work) => work(github, {}),
      });
      const mergingState: TaskState = {
        ...state(),
        phase: "merging",
        prNumber: 7,
        prUrl: pr.url,
        latestHeadSha: head,
      };
      await expect(auth.mergeReady(mergingState)).resolves.toBe(false);

      healthSpy.mockResolvedValueOnce({
        prNumber: 7,
        prUrl: pr.url,
        overallStatus: "HEALTHY",
        nextSteps: [],
        checks: [
          { name: "Merge Conflicts", status: "HEALTHY", details: [] },
          { name: "CI Status", status: "HEALTHY", details: [] },
        ],
        staleBase: {
          stale: false,
          headSha: head,
          mergeBaseSha: "b".repeat(40),
          mainHeadSha: "c".repeat(40),
          behindBy: 2,
          verdict: "disjoint_clean",
          reasons: [],
        },
      });
      await expect(auth.mergeReady(mergingState)).resolves.toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("mergeTask restacks on the host with zero repair turns, records telemetry, and saves awaiting_ci with the new head SHA", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "jpe-stale-merge-"));
    try {
      const paths = runtimePaths(home);
      const telemetry = new JustinTelemetry(paths, 45, () => Promise.resolve());
      await telemetry.begin();

      const runner = fakeTrackerRunner();
      const github = new GitHubClient(
        "owner/repo",
        {
          approver: { login: "owner", id: 1 },
          expectedBotLogin: "app/justin-principal-engineer",
        },
        runner,
        {},
      );
      const oldHead = "a".repeat(40);
      const newHead = "d".repeat(40);
      const pr: PullRequest = {
        number: 7,
        url: "https://example.com/pr/7",
        headRefOid: oldHead,
        headRefName: "agent/xx-1",
        baseRefName: "main",
        isDraft: false,
        state: "OPEN",
        mergedAt: null,
        mergeCommit: null,
        author: { login: "app/justin-principal-engineer", is_bot: true },
      };
      vi.spyOn(github, "pullRequest").mockResolvedValue(pr);
      vi.spyOn(github, "hasExactHeadApproval").mockResolvedValue(true);
      vi.spyOn(github, "feedback").mockResolvedValue([]);
      const mergeSpy = vi.spyOn(github, "merge");
      vi.spyOn(github, "health").mockResolvedValue({
        prNumber: 7,
        prUrl: pr.url,
        overallStatus: "HEALTHY",
        nextSteps: [],
        checks: [
          { name: "Merge Conflicts", status: "HEALTHY", details: [] },
          { name: "CI Status", status: "HEALTHY", details: [] },
        ],
        staleBase: {
          stale: true,
          headSha: oldHead,
          mergeBaseSha: "b".repeat(40),
          mainHeadSha: "c".repeat(40),
          behindBy: 3,
          verdict: "stale_overlap",
          reasons: ["workspace dependency overlap: @shepherdjerred/toolkit"],
        },
      });

      const restack = vi.fn(() => Promise.resolve(null));
      const submitUpdate = vi.fn(() => Promise.resolve());
      const headSha = vi.fn(() => Promise.resolve(newHead));
      const saved: TaskState[] = [];
      const messages: string[] = [];
      const initialState: TaskState = {
        ...state(),
        phase: "merging",
        prNumber: 7,
        prUrl: pr.url,
        latestHeadSha: oldHead,
        repairTurnsUsed: 2,
      };

      await mergeTask({
        state: initialState,
        withGitHub: (work) => work(github, { GH_TOKEN: "fixture" }),
        tracker: new TrackerClient("SJ", runner),
        save: saveStub(saved),
        writeInfo: infoCollector(messages),
        baseBranch: "main",
        store: { save: () => Promise.resolve() },
        ready: () => Promise.resolve(true),
        mergeCommand: ["justin", "merge-ready"],
        restackTask: (restackInput) =>
          restackStaleMergeTask({
            ...restackInput,
            git: { restack, submitUpdate, headSha },
            telemetry,
            save: saveStub(saved),
            writeInfo: infoCollector(messages),
          }),
        confirmMerged: () => Promise.resolve(),
      });
      await telemetry.finish("success", saved);

      expect(restack).toHaveBeenCalledOnce();
      expect(submitUpdate).toHaveBeenCalledOnce();
      expect(mergeSpy).not.toHaveBeenCalled();
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        phase: "awaiting_ci",
        latestHeadSha: newHead,
        repairTurnsUsed: 2,
        restackInProgress: false,
      });
      expect(messages[0]).toContain("restacked stale base onto current main");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
