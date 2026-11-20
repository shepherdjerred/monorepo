import { describe, expect, test, vi } from "vitest";
import {
  AgentOutputSchema,
  ConfigSchema,
  type TaskState,
} from "#src/domain/schemas.ts";
import { DockerAgentRunner } from "#src/host/docker.ts";
import { GitWorkspace } from "#src/host/git-workspace.ts";
import { createTaskState } from "#src/host/task-state.ts";
import { GitHubClient } from "#src/integrations/github.ts";
import { TrackerClient } from "#src/integrations/tracker.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { implementTask } from "#src/reconcile-implementation.ts";
import {
  finishPass,
  passTask,
  preparePassedRetry,
  snapshotAttempt,
} from "#src/reconcile-pass.ts";

function context() {
  return {
    issue: {
      id: "fixture-issue",
      identifier: "AI-42",
      title: "Keep the fixture usable",
      description: "Describe an observable outcome.",
      url: "https://tracker.example/issues/AI-42",
      priority: 1,
      createdAt: "2026-01-01T00:00:00Z",
      state: { type: "started", name: "In Progress" },
      labels: { nodes: [{ name: "agent:codex" }] },
    },
    comments: [
      {
        id: "first-human-comment",
        author: { kind: "human" },
        body: "Here is the failure.",
        editedAt: null,
      },
    ],
    prompt: "Fixture",
  };
}

function stateForAttempt(): TaskState {
  const details = context();
  return {
    ...createTaskState({
      issue: details.issue,
      provider: "codex",
      paths: runtimePaths("/fixture"),
    }),
    attemptContext: snapshotAttempt(details),
  };
}

const failUnexpectedCommand: CommandRunner = () =>
  Promise.reject(new Error("Unexpected external command"));

describe("passed task retry eligibility", () => {
  test("uses issue text and new or edited human comments", async () => {
    const current = context();
    const passed: TaskState = { ...stateForAttempt(), phase: "passed" };
    const issueContext = () => Promise.resolve(current);
    expect(await preparePassedRetry(passed, { issueContext })).toBeNull();

    current.issue.priority = 2;
    current.comments.push({
      id: "pass-comment",
      author: { kind: "runner" },
      body: "Justin passed.",
      editedAt: null,
    });
    expect(await preparePassedRetry(passed, { issueContext })).toBeNull();

    const human = current.comments[0];
    if (human === undefined) throw new Error("Fixture has no human comment");
    human.body = "Here is a fixture to reproduce the failure.";
    await expect(
      preparePassedRetry(passed, { issueContext }),
    ).resolves.toMatchObject({
      issue: { priority: 2 },
    });

    current.comments.splice(0, 1);
    expect(await preparePassedRetry(passed, { issueContext })).toBeNull();
    current.issue.description = "Use the existing regression test.";
    await expect(
      preparePassedRetry(passed, { issueContext }),
    ).resolves.toMatchObject({
      issue: { description: current.issue.description },
    });
  });
});

describe("parking a task with a PR", () => {
  test("closes once and retries the same Tracker note after an interruption", async () => {
    const attempt = {
      ...stateForAttempt(),
      prNumber: 99,
      prUrl: "https://github.com/example/repo/pull/99",
    };
    let persisted: TaskState = attempt;
    const store = {
      save: async (state: TaskState) => {
        persisted = state;
      },
    };
    const mutations: string[][] = [];
    let closed = false;
    const run: CommandRunner = async (args) => {
      const command = args[2];
      if (command === "close") {
        mutations.push([...args]);
        closed = true;
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          number: attempt.prNumber,
          url: attempt.prUrl,
          headRefOid: "a".repeat(40),
          headRefName: attempt.branch,
          baseRefName: "main",
          state: closed ? "CLOSED" : "OPEN",
          isDraft: false,
          author: { login: "app/justin-principal-engineer", is_bot: true },
          mergedAt: null,
          mergeCommit: null,
        }),
        stderr: "",
        timedOut: false,
      };
    };
    const github = new GitHubClient(
      "example/repo",
      {
        approver: { login: "owner", id: 1 },
        expectedBotLogin: "justin-principal-engineer[bot]",
      },
      run,
      {},
    );
    const parkPass = vi
      .fn()
      .mockRejectedValueOnce(new Error("Tracker disconnected"))
      .mockResolvedValueOnce(undefined);
    await passTask({
      state: attempt,
      reason: "agent_pass",
      note: "Cannot verify without the fixture. token=privatesample",
      store,
    });
    expect(persisted.phase).toBe("passing");
    expect(persisted.lastPass?.note).toContain("[redacted]");
    expect(persisted.lastPass?.note).not.toContain("privatesample");
    const finish = () =>
      finishPass({
        state: persisted,
        tracker: { parkPass, refreshIssue: async () => attempt.issue },
        withGitHub: async (work) => await work(github, {}),
        store,
        baseBranch: "main",
      });
    await expect(finish()).rejects.toThrow("Tracker disconnected");
    expect(persisted.phase).toBe("passing");
    expect(persisted.lastPass?.closedPullRequest).toBe(true);
    await finish();
    expect(persisted).toMatchObject({ phase: "passed", prNumber: 99 });
    expect(mutations).toEqual([
      ["gh", "pr", "close", "99", "--repo", "example/repo"],
    ]);
    expect(parkPass.mock.calls[0]?.[1]).toEqual(parkPass.mock.calls[1]?.[1]);
  });
});

describe("unchanged coding turns", () => {
  test.each([
    { verification: [], editDuringTurn: false, expected: "passing" },
    {
      verification: ["Existing regression test passed"],
      editDuringTurn: false,
      expected: "done",
    },
    {
      verification: ["Existing regression test passed"],
      editDuringTurn: true,
      expected: "passing",
    },
  ])(
    "ends in $expected with verification=$verification and edit=$editDuringTurn",
    async ({ verification, editDuringTurn, expected }) => {
      const current = context();
      const paths = runtimePaths("/fixture");
      const config = ConfigSchema.parse(
        await Bun.file(
          new URL("../config.example.json", import.meta.url),
        ).json(),
      );
      const tracker = new TrackerClient("AI", failUnexpectedCommand);
      vi.spyOn(tracker, "issueContext").mockImplementation(() =>
        Promise.resolve(current),
      );
      const complete = vi
        .spyOn(tracker, "completeNoChange")
        .mockResolvedValue(undefined);
      const git = new GitWorkspace(config, failUnexpectedCommand);
      vi.spyOn(git, "publicationPaths").mockResolvedValue([]);
      const agent = new DockerAgentRunner(config, failUnexpectedCommand);
      vi.spyOn(agent, "runTurn").mockImplementation(async ({ onStart }) => {
        await onStart?.();
        if (editDuringTurn)
          current.issue.description = "Verify a different behavior now.";
        return AgentOutputSchema.parse({
          status: "no_change",
          commitTitle: "fix(test): confirm behavior",
          summary: "The requested behavior already exists.",
          verification,
        });
      });
      const initial: TaskState = {
        ...stateForAttempt(),
        phase: "implementing",
      };
      let saved = initial;
      const store = new StateStore(paths);
      vi.spyOn(store, "save").mockImplementation((state) => {
        saved = state;
        return Promise.resolve();
      });
      await implementTask({
        state: initial,
        tracker,
        git,
        agent,
        store,
        save: (state, phase, patch) => {
          saved = { ...state, ...patch, phase };
          return Promise.resolve(saved);
        },
      });
      expect(saved.phase).toBe(expected);
      if (expected === "done")
        expect(complete).toHaveBeenCalledExactlyOnceWith(
          current.issue,
          expect.stringContaining("Existing regression test passed"),
        );
      else expect(complete).not.toHaveBeenCalled();
    },
  );
});
