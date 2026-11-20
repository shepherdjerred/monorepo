import { expect, test, vi } from "vitest";
import {
  ConfigSchema,
  type AgentOutput,
  type TaskState,
} from "#src/domain/schemas.ts";
import { DeliveryAuthorization } from "#src/host/delivery-authorization.ts";
import { DockerAgentRunner } from "#src/host/docker.ts";
import { GitWorkspace } from "#src/host/git-workspace.ts";
import { createTaskState } from "#src/host/task-state.ts";
import { GitHubClient } from "#src/integrations/github.ts";
import { TrackerClient } from "#src/integrations/tracker.ts";
import { publishTask } from "#src/reconcile-publication.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

const run: CommandRunner = () =>
  Promise.reject(new Error("Unexpected external command"));

test("verifies a passed branch, saves old approvals, and reopens the same PR", async () => {
  const config = ConfigSchema.parse(
    await Bun.file(new URL("../config.example.json", import.meta.url)).json(),
  );
  const paths = runtimePaths("/fixture");
  const output: AgentOutput = {
    status: "changed",
    commitTitle: "fix(thing): preserve earlier work",
    summary: "Verified task branch",
    verification: [],
    resolvedFindings: [],
    resolvedFindingKeys: [],
    visualTargets: [],
  };
  const initial: TaskState = {
    ...createTaskState({
      issue: {
        description: null,
        id: "fixture",
        identifier: "AI-42",
        title: "Preserve earlier work",
        url: "https://tracker.example/issues/AI-42",
        priority: 1,
        createdAt: "2026-01-01T00:00:00Z",
        state: { type: "started", name: "In Progress" },
        labels: { nodes: [{ name: "agent:codex" }] },
      },
      paths,
      provider: "codex",
    }),
    phase: "publishing",
    lastAgentOutput: output,
    lastPass: {
      id: crypto.randomUUID(),
      reason: "agent_pass",
      note: "Waiting for fixture",
      closedPullRequest: true,
    },
    prNumber: 42,
    prUrl: "https://github.com/example/repo/pull/42",
  };
  const github = new GitHubClient(
    config.repository.slug,
    {
      approver: {
        login: config.github.approverLogin,
        id: config.github.approverId,
      },
      expectedBotLogin: config.github.botLogin,
    },
    run,
    {},
  );
  const pr = {
    number: 42,
    url: "https://github.com/example/repo/pull/42",
    author: { login: config.github.botLogin, is_bot: true },
    headRefName: initial.branch,
    baseRefName: config.repository.baseBranch,
    headRefOid: "a".repeat(40),
    mergeCommit: null,
    mergedAt: null,
    isDraft: true,
  } as const;
  vi.spyOn(github, "pullRequest").mockResolvedValue({ ...pr, state: "CLOSED" });
  vi.spyOn(github, "openPullRequestNumbers").mockResolvedValue([77, 88]);
  vi.spyOn(github, "approvalIds").mockResolvedValue([123]);
  vi.spyOn(github, "pullRequestForBranch").mockResolvedValue({
    ...pr,
    state: "OPEN",
  });
  vi.spyOn(github, "resolveFindings").mockResolvedValue([]);
  vi.spyOn(github, "updateBody").mockResolvedValue(undefined);

  let persisted = initial;
  const git = new GitWorkspace(config, run);
  vi.spyOn(git, "preparePublication").mockResolvedValue([
    output,
    ["src/file.ts"],
  ]);
  vi.spyOn(git, "publicationPaths").mockResolvedValue(["src/file.ts"]);
  const update = vi.spyOn(git, "publishChanges").mockResolvedValue(undefined);
  const create = vi.spyOn(git, "commitAndSubmit").mockResolvedValue(undefined);
  const agent = new DockerAgentRunner(config, run);
  const verify = vi
    .spyOn(agent, "verifyWorkspace")
    .mockResolvedValue(["Host checks passed"]);
  const tracker = new TrackerClient("AI", run);
  vi.spyOn(tracker, "agentContext").mockResolvedValue(null);
  const withGitHub = async <T>(
    work: (client: GitHubClient, env: Record<string, string>) => Promise<T>,
  ) => await work(github, {});
  const reopen = vi
    .spyOn(github, "setPullRequestOpen")
    .mockImplementation(() => {
      expect(verify).toHaveBeenCalled();
      expect(persisted.previousApprovalIds).toEqual([123]);
      return Promise.resolve();
    });
  await publishTask({
    state: initial,
    baseBranch: config.repository.baseBranch,
    authorization: new DeliveryAuthorization({
      config,
      paths,
      tracker,
      git,
      run,
      withGitHub,
    }),
    git,
    tracker,
    agent,
    paths,
    run,
    withGitHub,
    save: (state, phase, patch) => {
      persisted = { ...state, ...patch, phase };
      return Promise.resolve(persisted);
    },
  });
  expect(reopen).toHaveBeenCalledExactlyOnceWith(42, true);
  expect(update).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
  expect(persisted).toMatchObject({
    prNumber: 42,
    previousApprovalIds: [123],
    phase: "awaiting_ci",
    lastPass: { closedPullRequest: false },
  });
});
