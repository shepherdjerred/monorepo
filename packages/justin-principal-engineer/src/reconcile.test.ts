import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { AgentOutputSchema, ConfigSchema } from "#src/domain/schemas.ts";
import { fakeLinearRunner } from "#src/integrations/fake-linear.ts";
import { Reconciler } from "#src/reconcile.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { createTaskState } from "#src/host/task-state.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { DEVEX_PROJECT_ID } from "#src/domain/autonomy.ts";
import { GitWorkspace } from "#src/host/git-workspace.ts";
import { GitHubClient, type PullRequest } from "#src/integrations/github.ts";
import { DockerAgentRunner } from "#src/host/docker.ts";
import { LinearClient } from "#src/integrations/linear.ts";

vi.mock("#src/integrations/github-app.ts", () => ({
  createGitHubAuth: async () => ({
    env: { GH_TOKEN: "fixture-credential" },
    cleanup: () => Promise.resolve(),
  }),
}));

function respond(value: unknown) {
  return {
    exitCode: 0,
    stdout: JSON.stringify(value),
    stderr: "",
    timedOut: false,
  };
}

async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), "jpe-reconcile-"));
  const paths = runtimePaths(home);
  const config = ConfigSchema.parse(
    await Bun.file(
      path.join(import.meta.dirname, "../config.example.json"),
    ).json(),
  );
  const messages: string[] = [];
  const output = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      messages.push(String(chunk));
      return true;
    });
  return {
    paths,
    config,
    messages,
    cleanup: async () => {
      output.mockRestore();
      await rm(home, { recursive: true });
    },
  };
}

describe("reconcile lock reporting", () => {
  test("a quiet successful reconcile does not report lock contention", async () => {
    const { paths, config, messages, cleanup } = await fixture();
    try {
      await new Reconciler(config, paths, fakeLinearRunner()).reconcile();
      expect(messages).toEqual(["Queue is quiet: no eligible Linear issue\n"]);
    } finally {
      await cleanup();
    }
  });

  test("an actual lock owner prevents querying the queue", async () => {
    const { paths, config, messages, cleanup } = await fixture();
    const calls: string[][] = [];
    const acquired = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const owner = new StateStore(paths).withLock(async () => {
      acquired.resolve(undefined);
      await release.promise;
    });
    try {
      await acquired.promise;
      await new Reconciler(config, paths, fakeLinearRunner(calls)).reconcile();
      expect(calls).toEqual([]);
      expect(messages).toEqual([
        "Another reconciler owns the local lock; exiting\n",
      ]);
    } finally {
      release.resolve(undefined);
      await owner;
      await cleanup();
    }
  });
});

describe("CI authorization recovery", () => {
  test("parks the task before restacking or starting coding and preserves the observed head", async () => {
    const { paths, config, cleanup } = await fixture();
    const head = "a".repeat(40);
    const store = new StateStore(paths);
    const state = createTaskState({
      paths,
      provider: "codex",
      issue: {
        id: "node-1",
        identifier: "SJ-1",
        title: "Fixture issue",
        description: null,
        url: "https://linear.app/example/issue/SJ-1",
        priority: 0,
        team: { key: "SJ" },
        createdAt: "2026-01-01T00:00:00Z",
        state: { name: "In Progress", type: "started" },
        labels: { nodes: [{ name: "agent:codex" }] },
      },
    });
    const calls: string[][] = [];
    const linearRun = fakeLinearRunner(calls);
    const health = {
      prNumber: 1,
      prUrl: "https://github.com/owner/repo/pull/1",
      overallStatus: "UNHEALTHY",
      checks: [
        { name: "Merge Conflicts", status: "PENDING", details: [] },
        {
          name: "CI Status",
          status: "UNHEALTHY",
          details: [
            "Woodpecker pipeline #42 for exact head aaaaaaaaaaaa: ERROR",
          ],
        },
      ],
      nextSteps: [],
    };
    const run: CommandRunner = async (args, options) => {
      if (args[0] === "op")
        return { ...respond(null), stdout: "fixture-credential" };
      if (args[0] === "gh" && args[1] === "pr")
        return respond({
          number: 1,
          url: health.prUrl,
          headRefOid: head,
          baseRefName: "main",
          headRefName: state.branch,
          mergeCommit: null,
          isDraft: true,
          mergedAt: null,
          author: { login: "app/justin-principal-engineer", is_bot: true },
        });
      if (args[0] === "gh") return respond([[]]);
      if (args[1] === "pr" && args[2] === "health") {
        expect(options?.env?.["WOODPECKER_URL"]).toBe(
          config.woodpecker.baseUrl,
        );
        expect(options?.env?.["WOODPECKER_REPO_ID"]).toBe("1");
        return respond(health);
      }
      if (args[1] === "linear") return await linearRun(args, options);
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    };
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        number: 42,
        commit: head,
        status: "error",
        errors: [
          { message: "actor is not permitted to run CI", is_warning: false },
        ],
      }),
    );
    try {
      await store.save({
        ...state,
        phase: "awaiting_ci",
        resumePhase: null,
        prNumber: 1,
        prUrl: health.prUrl,
      });
      await new Reconciler(config, paths, run).reconcile();
      const states = await store.list();
      const saved = states[0];
      expect(saved?.phase).toBe("needs_human");
      expect(saved?.resumePhase).toBe("awaiting_ci");
      expect(saved?.latestHeadSha).toBe(head);
      expect(saved?.failureCount).toBe(0);
      const mutation = calls.find(
        (args) => args[3]?.includes("issueUpdate") === true,
      );
      expect(mutation).toBeDefined();
      expect(
        JSON.parse(
          mutation?.[mutation.indexOf("--variables-json") + 1] ?? "{}",
        ),
      ).toEqual({ id: "node-1", add: ["sj-needs-human-id"], remove: [] });
      await new Reconciler(config, paths, run).reconcile();
      const parked = await store.list();
      expect(parked[0]?.phase).toBe("needs_human");
    } finally {
      request.mockRestore();
      await cleanup();
    }
  });
});

async function autonomousFixture() {
  const fixtureState = await fixture();
  const { paths, config } = fixtureState;
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  await Bun.write(
    paths.config,
    JSON.stringify({
      ...config,
      autonomy: { enabledIssueIdentifiers: ["AI-104"] },
    }),
  );
  const state = createTaskState({
    paths,
    provider: "codex",
    deliveryMode: "autonomous",
    issue: {
      id: "issue-104",
      identifier: "AI-104",
      title: "CLI help",
      description: null,
      url: "https://linear.app/example/issue/AI-104",
      priority: 1,
      team: { key: "AI" },
      project: { id: DEVEX_PROJECT_ID, name: "Developer Experience" },
      createdAt: "2026-01-01T00:00:00Z",
      state: { name: "In Progress", type: "started" },
      labels: {
        nodes: [{ name: "agent:codex" }, { name: "agent:autonomous" }],
      },
    },
  });
  const head = "a".repeat(40);
  const pr: PullRequest = {
    number: 42,
    url: "https://github.com/owner/repo/pull/42",
    headRefOid: head,
    headRefName: state.branch,
    baseRefName: "main",
    isDraft: false,
    mergedAt: null,
    mergeCommit: null,
    author: { login: "app/justin-principal-engineer", is_bot: true },
  };
  const calls: string[][] = [];
  const linearRun = fakeLinearRunner(calls, { refreshNodes: [state.issue] });
  const run: CommandRunner = async (args, options) => {
    if (args[0] === "op")
      return { ...respond(null), stdout: "fixture-credential" };
    if (args[1] === "linear") return await linearRun(args, options);
    if (args[0] === "git")
      return {
        ...respond(null),
        stdout:
          args[1] === "show"
            ? JSON.stringify({ workspaces: ["packages/toolkit"] })
            : "",
      };
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  };
  vi.spyOn(GitHubClient.prototype, "pullRequest").mockResolvedValue(pr);
  vi.spyOn(GitHubClient.prototype, "feedback").mockResolvedValue([]);
  vi.spyOn(GitHubClient.prototype, "health").mockResolvedValue({
    prNumber: pr.number,
    prUrl: pr.url,
    overallStatus: "HEALTHY",
    nextSteps: [],
    checks: [
      { name: "Merge Conflicts", status: "HEALTHY", details: [] },
      { name: "CI Status", status: "HEALTHY", details: [] },
    ],
  });
  const approval = vi
    .spyOn(GitHubClient.prototype, "hasExactHeadApproval")
    .mockResolvedValue(false);
  const merge = vi.spyOn(GitHubClient.prototype, "merge").mockResolvedValue({
    ...pr,
    mergedAt: "2026-01-01T00:00:00Z",
    mergeCommit: { oid: "b".repeat(40) },
  });
  vi.spyOn(GitWorkspace.prototype, "publicationPaths").mockResolvedValue([
    "packages/toolkit/src/handlers/pr.ts",
  ]);
  vi.spyOn(GitWorkspace.prototype, "headSha").mockResolvedValue(head);
  const confirmation = vi
    .spyOn(GitWorkspace.prototype, "confirmMerged")
    .mockResolvedValue(undefined);
  const store = new StateStore(paths);
  await store.save({
    ...state,
    phase: "awaiting_ci",
    resumePhase: null,
    prNumber: pr.number,
    prUrl: pr.url,
    latestHeadSha: head,
  });
  return {
    ...fixtureState,
    state,
    pr,
    store,
    run,
    calls,
    approval,
    merge,
    confirmation,
    cleanup: async () => {
      vi.restoreAllMocks();
      await shutdownFeatureFlags();
      await fixtureState.cleanup();
    },
  };
}

describe("explicit autonomous retry", () => {
  test("preserves completed coding output, continuation, and repair budget", async () => {
    const f = await autonomousFixture();
    const output = AgentOutputSchema.parse({
      status: "changed",
      commitTitle: "fix(toolkit): cover nested help",
      summary: "Completed CLI repair",
      verification: [],
    });
    try {
      await f.store.save({
        ...f.state,
        phase: "blocked",
        blockedFromPhase: "publishing",
        blockedReason: "Former manifest restriction",
        repairTurnsUsed: 2,
        implementationStarted: true,
        lastAgentOutput: output,
        nextAttemptAt: null,
      });
      await new Reconciler(f.config, f.paths, f.run).retryTask("AI-104");
      const states = await f.store.list();
      expect(states[0]?.phase).toBe("blocked");
      expect(states[0]?.blockedFromPhase).toBe("publishing");
      expect(states[0]?.repairTurnsUsed).toBe(2);
      expect(states[0]?.implementationStarted).toBe(true);
      expect(states[0]?.lastAgentOutput).toEqual(output);
      expect(states[0]?.nextAttemptAt).not.toBeNull();
      expect(f.merge).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  test("rejects a remaining scope violation without changing state or labels", async () => {
    const f = await autonomousFixture();
    vi.spyOn(GitWorkspace.prototype, "publicationPaths").mockResolvedValue([
      "packages/toolkit/src/lib/github/client.ts",
    ]);
    try {
      const state = {
        ...f.state,
        phase: "blocked" as const,
        blockedFromPhase: "publishing" as const,
        repairTurnsUsed: 1,
        nextAttemptAt: null,
      };
      await f.store.save(state);
      await expect(
        new Reconciler(f.config, f.paths, f.run).retryTask("AI-104"),
      ).rejects.toThrow("Autonomous scope excludes");
      expect(await f.store.list()).toEqual([state]);
      expect(f.calls.some((args) => args[3]?.includes("issueUpdate"))).toBe(
        false,
      );
    } finally {
      await f.cleanup();
    }
  });

  test("revoked targeting cannot be bypassed by an explicit retry", async () => {
    const f = await autonomousFixture();
    try {
      await Bun.write(f.paths.config, JSON.stringify(f.config));
      await f.store.save({
        ...f.state,
        phase: "blocked",
        blockedFromPhase: "publishing",
        repairTurnsUsed: 1,
      });
      await expect(
        new Reconciler(f.config, f.paths, f.run).retryTask("AI-104"),
      ).rejects.toThrow("flag is disabled");
      const states = await f.store.list();
      expect(states[0]?.nextAttemptAt).toBeNull();
      expect(states[0]?.repairTurnsUsed).toBe(1);
      expect(f.merge).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });
});

describe("autonomous promotion review", () => {
  test("promotion reviews current acceptance criteria and findings without resetting the budget", async () => {
    const f = await autonomousFixture();
    const finding = { provider: "codex" as const, key: "fixture-finding" };
    vi.spyOn(GitWorkspace.prototype, "restack").mockResolvedValue(null);
    vi.spyOn(GitHubClient.prototype, "reviewDiagnostics").mockResolvedValue({
      text: "Existing review finding",
      findings: [finding],
      blockedReasons: [],
    });
    vi.spyOn(LinearClient.prototype, "agentContext").mockResolvedValue(
      "Current private acceptance criteria",
    );
    vi.spyOn(GitWorkspace.prototype, "changedPaths").mockResolvedValue([
      "packages/toolkit/src/handlers/pr.test.ts",
    ]);
    const agent = vi
      .spyOn(DockerAgentRunner.prototype, "runTurn")
      .mockImplementation(async (input) => {
        expect(input.prompt).toContain("Current private acceptance criteria");
        expect(input.prompt).toContain("Existing review finding");
        await input.onStart?.();
        return AgentOutputSchema.parse({
          status: "changed",
          commitTitle: "test(toolkit): cover nested help",
          summary: "Adds required regressions",
          verification: [],
          resolvedFindings: [finding],
        });
      });
    try {
      await f.store.save({
        ...f.state,
        deliveryMode: "owner_approved",
        phase: "needs_human",
        resumePhase: "awaiting_ci",
        prNumber: f.pr.number,
        prUrl: f.pr.url,
        repairTurnsUsed: 1,
        implementationStarted: true,
      });
      const reconciler = new Reconciler(f.config, f.paths, f.run);
      await reconciler.reconcile();
      const claimedStates = await f.store.list();
      const claimed = claimedStates[0];
      expect(claimed?.autonomyReviewPending).toBe(true);
      expect(claimed?.repairTurnsUsed).toBe(1);
      expect(claimed?.phase).toBe("awaiting_ci");
      if (claimed === undefined) throw new Error("Claimed fixture missing");
      expect(await reconciler.mergeReady(claimed)).toBe(false);
      await reconciler.reconcile();
      const reviewStates = await f.store.list();
      const review = reviewStates[0];
      expect(review?.phase).toBe("implementing");
      expect(review?.pendingReviewFindings).toEqual([finding]);
      expect(review?.repairTurnsUsed).toBe(1);
      expect(agent).not.toHaveBeenCalled();
      expect(f.merge).not.toHaveBeenCalled();
      await reconciler.reconcile();
      const publishingStates = await f.store.list();
      const publishing = publishingStates[0];
      expect(publishing?.phase).toBe("publishing");
      expect(publishing?.autonomyReviewPending).toBe(false);
      expect(publishing?.repairTurnsUsed).toBe(2);
      expect(agent).toHaveBeenCalledOnce();
      expect(f.merge).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  test.each(["awaiting_ci", "publishing", "merging"] as const)(
    "legacy autonomous state in %s cannot skip the fresh review after restart",
    async (phase) => {
      const f = await autonomousFixture();
      const restack = vi
        .spyOn(GitWorkspace.prototype, "restack")
        .mockResolvedValue(null);
      vi.spyOn(GitHubClient.prototype, "reviewDiagnostics").mockResolvedValue({
        text: "Existing review",
        findings: [],
        blockedReasons: [],
      });
      const agent = vi.spyOn(DockerAgentRunner.prototype, "runTurn");
      try {
        const legacy = {
          ...f.state,
          phase,
          prNumber: f.pr.number,
          prUrl: f.pr.url,
          repairTurnsUsed: 2,
          implementationStarted: true,
        };
        Reflect.deleteProperty(legacy, "autonomyReviewPending");
        await Bun.write(
          path.join(f.paths.state, "ai-104.json"),
          JSON.stringify(legacy),
        );
        await new Reconciler(f.config, f.paths, f.run).reconcile();
        const savedStates = await f.store.list();
        const saved = savedStates[0];
        expect(saved?.phase).toBe("implementing");
        expect(saved?.autonomyReviewPending).toBe(true);
        expect(saved?.repairTurnsUsed).toBe(2);
        expect(restack).toHaveBeenCalledTimes(phase === "publishing" ? 0 : 1);
        expect(agent).not.toHaveBeenCalled();
        expect(f.merge).not.toHaveBeenCalled();
        expect(f.calls.some((args) => args.includes("Done"))).toBe(false);
      } finally {
        await f.cleanup();
      }
    },
  );
});

describe("autonomous merge acceptance", () => {
  test("a due blocked claim retries Linear claim and preserves its continuation", async () => {
    const f = await autonomousFixture();
    const claim = vi
      .spyOn(LinearClient.prototype, "claim")
      .mockResolvedValue(undefined);
    try {
      await f.store.save({
        ...f.state,
        phase: "blocked",
        blockedFromPhase: "claiming",
        resumePhase: "awaiting_ci",
        nextAttemptAt: "2026-01-01T00:00:00Z",
      });
      await new Reconciler(f.config, f.paths, f.run).reconcile();
      expect(claim).toHaveBeenCalledOnce();
      const states = await f.store.list();
      expect(states[0]?.phase).toBe("awaiting_ci");
    } finally {
      await f.cleanup();
    }
  });

  test("an already merged legacy PR confirms ancestry without another coding turn", async () => {
    const f = await autonomousFixture();
    vi.spyOn(GitHubClient.prototype, "pullRequest").mockResolvedValue({
      ...f.pr,
      mergedAt: "2026-01-01T00:00:00Z",
      mergeCommit: { oid: "b".repeat(40) },
    });
    const restack = vi.spyOn(GitWorkspace.prototype, "restack");
    const agent = vi.spyOn(DockerAgentRunner.prototype, "runTurn");
    try {
      await f.store.save({
        ...f.state,
        phase: "merging",
        prNumber: f.pr.number,
        prUrl: f.pr.url,
        autonomyReviewPending: true,
      });
      const reconciler = new Reconciler(f.config, f.paths, f.run);
      await reconciler.reconcile();
      await reconciler.reconcile();
      const states = await f.store.list();
      expect(states[0]?.phase).toBe("done");
      expect(f.confirmation).toHaveBeenCalledOnce();
      expect(restack).not.toHaveBeenCalled();
      expect(agent).not.toHaveBeenCalled();
      expect(f.merge).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });
});

describe("autonomous publication and completion", () => {
  test.each([false, true])(
    "publishes only after verification and finding resolution (verification failure: %s)",
    async (verificationFails) => {
      const f = await autonomousFixture();
      const events: string[] = [];
      const finding = { provider: "coderabbit" as const, key: "finding-1" };
      const output = AgentOutputSchema.parse({
        status: "changed",
        commitTitle: "fix(toolkit): honor the argument boundary",
        summary: "Fixture repair",
        verification: [],
        resolvedFindings: [finding],
      });
      vi.spyOn(LinearClient.prototype, "agentContext").mockResolvedValue("");
      vi.spyOn(GitWorkspace.prototype, "preparePublication").mockResolvedValue([
        output,
        ["packages/toolkit/src/handlers/pr.ts"],
      ]);
      vi.spyOn(
        DockerAgentRunner.prototype,
        "verifyWorkspace",
      ).mockImplementation(() => {
        events.push("verify");
        return verificationFails
          ? Promise.reject(new Error("Verification failed"))
          : Promise.resolve(["Focused build, typecheck, test, lint passed"]);
      });
      vi.spyOn(
        GitHubClient.prototype,
        "pullRequestForBranch",
      ).mockResolvedValue(f.pr);
      const resolve = vi
        .spyOn(GitHubClient.prototype, "resolveFindings")
        .mockImplementation(() => {
          events.push("resolve");
          return Promise.resolve([finding]);
        });
      vi.spyOn(GitWorkspace.prototype, "publishChanges").mockImplementation(
        () => {
          events.push("publish");
          return Promise.resolve();
        },
      );
      vi.spyOn(GitHubClient.prototype, "updateBody").mockResolvedValue(
        undefined,
      );
      try {
        await f.store.save({
          ...f.state,
          phase: "publishing",
          prNumber: f.pr.number,
          prUrl: f.pr.url,
          lastAgentOutput: output,
          pendingReviewFindings: [finding],
        });
        await new Reconciler(f.config, f.paths, f.run).reconcile();
        if (verificationFails) {
          expect(events).toEqual(["verify"]);
          expect(resolve).not.toHaveBeenCalled();
        } else {
          expect(events).toEqual(["verify", "resolve", "publish"]);
          expect(resolve).toHaveBeenCalledWith(
            f.pr.number,
            expect.stringContaining(
              "Focused build, typecheck, test, lint passed",
            ),
            f.state.checkoutPath,
            [finding],
          );
          const states = await f.store.list();
          expect(states[0]?.pendingReviewFindings).toEqual([]);
        }
      } finally {
        await f.cleanup();
      }
    },
  );

  test("green CI goes directly to merge and completes only after ancestry confirmation", async () => {
    const f = await autonomousFixture();
    try {
      const reconciler = new Reconciler(f.config, f.paths, f.run);
      await reconciler.reconcile();
      const pending = await f.store.list();
      expect(pending.map((state) => state.phase)).toEqual(["merging"]);
      await reconciler.reconcile();
      const states = await f.store.list();
      expect(states[0]?.phase).toBe("done");
      expect(states[0]?.mergeCommitSha).toBe("b".repeat(40));
      expect(f.approval).not.toHaveBeenCalled();
      expect(f.merge).toHaveBeenCalledOnce();
      expect(f.confirmation).toHaveBeenCalledOnce();
      expect(f.calls.some((args) => args.includes("Done"))).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  test("failed base ancestry leaves Linear non-terminal and yields a retryable task", async () => {
    const f = await autonomousFixture();
    f.confirmation.mockRejectedValue(new Error("Merge commit is not on main"));
    try {
      const reconciler = new Reconciler(f.config, f.paths, f.run);
      await reconciler.reconcile();
      await reconciler.reconcile();
      const states = await f.store.list();
      expect(states[0]?.phase).toBe("blocked");
      expect(states[0]?.nextAttemptAt).not.toBeNull();
      expect(states[0]?.mergeCommitSha).toBeNull();
      expect(f.calls.some((args) => args.includes("Done"))).toBe(false);
    } finally {
      await f.cleanup();
    }
  });

  test("revoking the file policy blocks the task before any merge", async () => {
    const f = await autonomousFixture();
    try {
      await Bun.write(f.paths.config, JSON.stringify(f.config));
      await new Reconciler(f.config, f.paths, f.run).reconcile();
      const states = await f.store.list();
      expect(states[0]?.phase).toBe("blocked");
      expect(states[0]?.blockedReason).toContain("flag is disabled");
      expect(f.merge).not.toHaveBeenCalled();
      expect(f.calls.some((args) => args.includes("Done"))).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
});
