import { describe, expect, test, vi } from "vitest";

import {
  TaskStateSchema,
  type LinearIssue,
  type TaskState,
} from "#src/domain/schemas.ts";
import { fakeLinearRunner } from "#src/integrations/fake-linear.ts";
import { LinearClient } from "#src/integrations/linear.ts";
import {
  completeTask,
  pauseTask,
  queueUnhealthy,
} from "#src/reconcile-merge.ts";
import { AutonomousBlocker } from "#src/domain/autonomy.ts";
import { GitHubClient, type PullRequest } from "#src/integrations/github.ts";

function state(): TaskState {
  const issue: LinearIssue = {
    id: "node-1",
    identifier: "XX-1",
    title: "XX-1",
    description: null,
    url: "https://linear.app/example/issue/XX-1",
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
    const linear = new LinearClient("SJ", fakeLinearRunner());
    await pauseTask({
      state: state(),
      reason: "reason",
      linear,
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
    const linear = new LinearClient(
      "SJ",
      fakeLinearRunner([], { mutateSuccess: false }),
    );
    await expect(
      pauseTask({
        state: state(),
        reason: "reason",
        linear,
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
    const linear = new LinearClient("SJ", fakeLinearRunner(calls));
    await expect(
      pauseTask({
        state: state(),
        reason: "reason",
        linear,
        store: {
          save: (): Promise<void> => Promise.reject(new Error("disk is full")),
        },
      }),
    ).rejects.toThrow(/disk is full/);
    const mutations = calls.filter(
      (args) => args[2] === "api" && args[3]?.includes("issueUpdate") === true,
    );
    expect(mutations).toHaveLength(2);
    const variables = mutations.map((call) =>
      JSON.parse(call[call.indexOf("--variables-json") + 1] ?? "{}"),
    );
    expect(variables[0]).toEqual({
      id: "node-1",
      add: ["sj-needs-human-id"],
      remove: [],
    });
    expect(variables[1]).toEqual({
      id: "node-1",
      add: [],
      remove: ["sj-needs-human-id"],
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
  ])("classifies $failures", async ({ failures, retryableBlock }) => {
    const github = new GitHubClient(
      "owner/repo",
      {
        approver: { login: "owner", id: 1 },
        expectedBotLogin: "app/justin-principal-engineer",
      },
      fakeLinearRunner(),
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
    const linear = new LinearClient("SJ", fakeLinearRunner(calls));
    const messages: string[] = [];
    await completeTask({
      state: {
        ...state(),
        phase: "completing",
        prNumber: 7,
        prUrl: "https://example.com/pr/7",
      },
      linear,
      save: saveStub(saved),
      writeInfo: (message: string) => {
        messages.push(message);
      },
    });
    const mutations = calls.filter(
      (args) => args[2] === "api" && args[3]?.includes("issueUpdate") === true,
    );
    expect(mutations).toHaveLength(1);
    const raw = mutations[0]?.[mutations[0]?.indexOf("--variables-json") + 1];
    expect(JSON.parse(raw ?? "{}")).toEqual({
      id: "node-1",
      add: [],
      remove: ["sj-codex-id"],
    });
    expect(saved.map(({ phase }) => phase)).toEqual(["done"]);
    expect(saved[0]?.resumePhase).toBeNull();
    expect(messages).toEqual(["XX-1: merged https://example.com/pr/7"]);
  });

  test("completes the no-change path without a PR", async () => {
    const calls: string[][] = [];
    const saved: TaskState[] = [];
    const messages: string[] = [];
    const linear = new LinearClient("SJ", fakeLinearRunner(calls));
    await completeTask({
      state: { ...state(), phase: "completing" },
      linear,
      save: saveStub(saved),
      writeInfo: infoCollector(messages),
    });
    expect(commentBodies(calls)).toEqual([
      "No change needed; the requested state was already present.",
    ]);
    expect(saved.map(({ phase }) => phase)).toEqual(["done"]);
    expect(messages).toEqual(["XX-1: no change was needed; issue completed"]);
  });

  test("a failed cleanup never reaches done", async () => {
    const saved: TaskState[] = [];
    const messages: string[] = [];
    const linear = new LinearClient(
      "SJ",
      fakeLinearRunner([], { mutateSuccess: false }),
    );
    await expect(
      completeTask({
        state: {
          ...state(),
          phase: "completing",
          prNumber: 7,
          prUrl: "https://example.com/pr/7",
        },
        linear,
        save: saveStub(saved),
        writeInfo: infoCollector(messages),
      }),
    ).rejects.toThrow(/label mutation failed/);
    expect(saved).toEqual([]);
    expect(messages).toEqual([]);
  });
});
