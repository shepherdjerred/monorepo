import { buildAgentPrompt } from "#src/agent/prompt.ts";
import { publicAgentOutput } from "#src/agent/public-output.ts";
import * as deliveryHealth from "#src/domain/delivery-health.ts";
import type { Config, PrHealth, TaskState } from "#src/domain/schemas.ts";
import { DockerAgentRunner } from "#src/host/docker.ts";
import { captureEvidence } from "#src/host/evidence.ts";
import { GitWorkspace } from "#src/host/git-workspace.ts";
import { createTaskState } from "#src/host/task-state.ts";
import { createGitHubAuth } from "#src/integrations/github-app.ts";
import { GitHubClient, type PullRequest } from "#src/integrations/github.ts";
import { LinearClient, providerForIssue } from "#src/integrations/linear.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import { writeInfo } from "#src/runtime/output.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { currentTimestamp } from "#src/runtime/time.ts";
import * as reconcileMerge from "#src/reconcile-merge.ts";
import { failureCountForSave } from "#src/reconcile-state.ts";
export class Reconciler {
  private readonly store: StateStore;
  private readonly linear: LinearClient;
  private readonly git: GitWorkspace;
  private readonly agent: DockerAgentRunner;
  public constructor(
    private readonly config: Config,
    private readonly paths: RuntimePaths,
    private readonly run: CommandRunner,
  ) {
    this.store = new StateStore(paths);
    this.linear = new LinearClient(config.linear.team, run);
    this.git = new GitWorkspace(config, run);
    this.agent = new DockerAgentRunner(config, run);
  }
  public async reconcile(): Promise<void> {
    await this.store.initialize();
    const outcome = await this.store.withLock(async () => {
      const states = await this.store.list();
      const active = states.find(
        ({ phase }) => phase !== "done" && phase !== "needs_human",
      );
      if (active !== undefined) {
        await this.advanceSafely(active);
        return;
      }
      const issue = await this.linear.nextIssue();
      if (issue === null) {
        writeInfo("Queue is quiet: no eligible Linear issue");
        return;
      }
      const provider = providerForIssue(issue);
      if (provider === undefined) {
        throw new Error(
          `${issue.identifier} does not select exactly one provider`,
        );
      }
      const timestamp = currentTimestamp();
      const existing = states.find(
        ({ issue: savedIssue }) => savedIssue.identifier === issue.identifier,
      );
      if (existing !== undefined) {
        if (existing.phase !== "needs_human") {
          throw new Error(
            `${issue.identifier} already has local state in ${existing.phase}`,
          );
        }
        const resumed: TaskState = {
          ...existing,
          issue,
          provider,
          phase: "claiming",
          resumePhase: existing.resumePhase ?? "implementing",
          failureCount: 0,
          lastFailureFingerprint: null,
          updatedAt: timestamp,
        };
        await this.store.save(resumed);
        await this.advanceSafely(resumed);
        return;
      }
      const state = createTaskState({ issue, provider, paths: this.paths });
      await this.store.save(state);
      await this.advanceSafely(state);
    });
    if (outcome === undefined) {
      writeInfo("Another reconciler owns the local lock; exiting");
    }
  }
  private async advanceSafely(initial: TaskState): Promise<void> {
    try {
      await this.advance(initial);
    } catch (error) {
      const states = await this.store.list();
      const latest =
        states.find(
          ({ issue }) => issue.identifier === initial.issue.identifier,
        ) ?? initial;
      await reconcileMerge.recordFailure({
        state: latest,
        error,
        linear: this.linear,
        store: this.store,
      });
    }
  }
  private async save(
    state: TaskState,
    phase: TaskState["phase"],
    patch: Partial<TaskState> = {},
  ): Promise<TaskState> {
    const next: TaskState = {
      ...state,
      ...patch,
      phase,
      updatedAt: currentTimestamp(),
      failureCount: failureCountForSave(state, phase),
      lastFailureFingerprint: null,
    };
    await this.store.save(next);
    return next;
  }
  private async advance(state: TaskState): Promise<void> {
    switch (state.phase) {
      case "claiming": {
        await this.linear.claim(state.issue);
        const nextPhase = state.resumePhase ?? "claimed";
        await this.save(state, nextPhase, { resumePhase: null });
        writeInfo(`Claimed ${state.issue.identifier} for ${state.provider}`);
        return;
      }
      case "claimed": {
        await this.withGitHub(async (_github, env) =>
          this.git.create(state.checkoutPath, state.branch, env),
        );
        await this.save(state, "implementing");
        writeInfo(`${state.issue.identifier}: task checkout is ready`);
        return;
      }
      case "implementing":
        await this.implement(state);
        return;
      case "publishing":
        await this.publish(state);
        return;
      case "awaiting_ci":
        await this.observeCi(state);
        return;
      case "awaiting_approval":
        await this.observeApproval(state);
        return;
      case "merging":
        await reconcileMerge.mergeTask({
          state,
          withGitHub: this.withGitHub.bind(this),
          linear: this.linear,
          save: this.save.bind(this),
          writeInfo,
        });
        return;
      case "needs_human":
      case "done":
        return;
    }
  }
  private async implement(state: TaskState): Promise<void> {
    const linearContext = await this.linear.agentContext(
      state.issue.identifier,
    );
    const output = await this.agent.runTurn({
      checkout: state.checkoutPath,
      provider: state.provider,
      prompt: buildAgentPrompt({
        state,
        linearContext,
        feedback: state.pendingFeedback,
        ...(state.pendingHealth === null
          ? {}
          : { health: state.pendingHealth }),
        ...(state.pendingDiagnostics === null
          ? {}
          : { diagnostics: state.pendingDiagnostics }),
      }),
    });
    const persistedOutput = publicAgentOutput(output);
    if (output.status === "needs_human") {
      await reconcileMerge.pauseTask({
        state,
        reason: persistedOutput.summary,
        linear: this.linear,
        store: this.store,
      });
      return;
    }
    const changed = await this.git.changedPaths(state.checkoutPath);
    const seenFeedbackIds = [
      ...new Set([
        ...state.seenFeedbackIds,
        ...state.pendingFeedback.map(({ id }) => id),
      ]),
    ];
    if (changed.length === 0) {
      if (state.prNumber === null) {
        if (output.status !== "no_change") {
          throw new Error(`Agent reported ${output.status} without a change`);
        }
        await this.linear.completeNoChange(state.issue.identifier);
        await this.save(state, "done", {
          lastAgentOutput: persistedOutput,
          pendingFeedback: [],
          pendingHealth: null,
          pendingDiagnostics: null,
          pendingCodexFindingKeys: [],
        });
        writeInfo(
          `${state.issue.identifier}: no change was needed; issue completed`,
        );
        return;
      }
      if (state.pendingHealth !== null)
        throw new Error(`Agent made no change: ${output.summary}`);
      if (state.pendingFeedback.length > 0) {
        await reconcileMerge.pauseAfterNoChangeFeedback({
          state,
          linear: this.linear,
          store: this.store,
        });
        return;
      }
      await this.save(state, "awaiting_ci", {
        lastAgentOutput: persistedOutput,
        pendingFeedback: [],
        pendingHealth: null,
        pendingDiagnostics: null,
        pendingCodexFindingKeys: [],
        seenFeedbackIds,
      });
      return;
    }
    await this.save(state, "publishing", {
      lastAgentOutput: persistedOutput,
      pendingFeedback: [],
      pendingHealth: null,
      pendingDiagnostics: null,
      pendingCodexFindingKeys: state.pendingCodexFindingKeys,
      evidencePublished: false,
      evidenceMarkdown: [],
      seenFeedbackIds,
    });
    writeInfo(
      `${state.issue.identifier}: agent turn completed; publishing next`,
    );
  }
  private async withGitHub<T>(
    work: (
      github: GitHubClient,
      env: Readonly<Record<string, string>>,
    ) => Promise<T>,
  ): Promise<T> {
    const auth = await createGitHubAuth(this.config, this.paths, this.run);
    try {
      const github = new GitHubClient(
        this.config.repository.slug,
        {
          approver: {
            login: this.config.github.approverLogin,
            id: this.config.github.approverId,
          },
          expectedBotLogin: this.config.github.botLogin,
        },
        this.run,
        auth.env,
      );
      return await work(github, auth.env);
    } finally {
      await auth.cleanup();
    }
  }
  private async publish(state: TaskState): Promise<void> {
    const output = state.lastAgentOutput;
    if (output === null)
      throw new Error("Publishing state has no agent output");
    const linearContext = await this.linear.agentContext(
      state.issue.identifier,
    );
    const [safeOutput, changed] = await this.git.preparePublication(
      output,
      state.checkoutPath,
      linearContext,
    );
    await this.withGitHub(async (github, env) => {
      let pr = await github.pullRequestForBranch(state.branch);
      if (pr === null) {
        if (changed.length > 0) {
          await this.git.commitAndSubmit({
            state,
            output: safeOutput,
            githubEnv: env,
          });
        } else {
          await this.git.submitExisting({
            state,
            output: safeOutput,
            githubEnv: env,
          });
        }
      } else if (changed.length > 0) {
        await this.git.publishChanges({
          state,
          output: safeOutput,
          githubEnv: env,
        });
      } else {
        const localHead = await this.git.headSha(state.checkoutPath);
        if (localHead !== pr.headRefOid)
          await this.git.submitUpdate(state, env);
      }
      pr = await github.pullRequestForBranch(state.branch);
      if (pr === null) throw new Error("No PR after submit");
      const eligibleKeys = output.resolvedFindingKeys.filter((key) =>
        state.pendingCodexFindingKeys.includes(key),
      );
      const resolvedKeys =
        eligibleKeys.length === 0
          ? []
          : await github.resolveCodexFindings(
              pr.number,
              `Addressed finding(s) ${eligibleKeys.join(", ")} in this follow-up turn. ${safeOutput.summary}`,
              state.checkoutPath,
              eligibleKeys,
            );
      state = {
        ...state,
        pendingCodexFindingKeys: state.pendingCodexFindingKeys.filter(
          (key) => !resolvedKeys.includes(key),
        ),
      };
      let current = await this.save(state, "publishing", {
        prNumber: pr.number,
        prUrl: pr.url,
        latestHeadSha: pr.headRefOid,
      });
      if (!current.evidencePublished) {
        const evidence = await captureEvidence({
          output,
          checkout: state.checkoutPath,
          prNumber: pr.number,
          githubEnv: env,
          paths: this.paths,
          identifier: state.issue.identifier,
          run: this.run,
          capture: async (target) => {
            await this.agent.captureScreenshot({
              checkout: state.checkoutPath,
              ...target,
            });
          },
        });
        current = await this.save(current, "publishing", {
          evidencePublished: true,
          evidenceMarkdown: [...current.evidenceMarkdown, ...evidence],
        });
      }
      await github.updateBody(
        pr.number,
        `${this.git.pullRequestBody(state, safeOutput)}${
          current.evidenceMarkdown.length === 0
            ? ""
            : `\n## Visual evidence\n\n${current.evidenceMarkdown.join("\n\n")}\n`
        }`,
      );
      await this.save(current, "awaiting_ci", { restackInProgress: false });
      writeInfo(`${state.issue.identifier}: ${pr.url} is waiting for CI`);
    });
  }
  private async observe(
    state: TaskState,
  ): Promise<
    | { kind: "transition" }
    | { kind: "health"; health: PrHealth; pr: PullRequest }
  > {
    return await this.withGitHub(async (github, env) => {
      if (state.prNumber === null) throw new Error("Observed task has no PR");
      const pr = await github.pullRequest(state.prNumber);
      const feedback = await github.feedback(
        state.prNumber,
        new Set(state.seenFeedbackIds),
      );
      if (feedback.length > 0) {
        await this.save(state, "implementing", {
          pendingFeedback: feedback,
          pendingHealth: null,
          pendingDiagnostics: null,
          latestHeadSha: pr.headRefOid,
        });
        writeInfo(
          `${state.issue.identifier}: owner feedback queued for a fresh turn`,
        );
        return { kind: "transition" };
      }
      const health = await github.health(state.prNumber, state.checkoutPath);
      if (deliveryHealth.deliveryNeedsRestack(health)) {
        const conflict = await this.git.restack(state.checkoutPath, env);
        await this.save(
          state,
          conflict === null ? "publishing" : "implementing",
          {
            pendingHealth: conflict === null ? null : health,
            pendingDiagnostics: conflict,
            restackInProgress: conflict !== null,
            latestHeadSha: pr.headRefOid,
            ...(conflict === null
              ? { evidencePublished: false, evidenceMarkdown: [] }
              : {}),
          },
        );
        writeInfo(
          `${state.issue.identifier}: ${conflict === null ? "restacked on current main" : "restack conflicts queued for a fresh turn"}`,
        );
        return { kind: "transition" };
      }
      if (state.failureCount > 0) {
        await this.save(state, state.phase, { latestHeadSha: pr.headRefOid });
      }
      return { kind: "health", health, pr };
    });
  }
  private async observeCi(state: TaskState): Promise<void> {
    const observation = await this.observe(state);
    if (observation.kind === "transition") return;
    if (await this.queueUnhealthy(state, observation.health, observation.pr)) {
      writeInfo(
        `${state.issue.identifier}: CI failure queued for a fresh turn`,
      );
      return;
    }
    if (!deliveryHealth.deliveryIsHealthy(observation.health)) {
      writeInfo(`${state.issue.identifier}: CI is still pending`);
      return;
    }
    await this.withGitHub(async (github) => {
      if (observation.pr.isDraft) await github.markReady(observation.pr.number);
    });
    await this.save(state, "awaiting_approval", {
      latestHeadSha: observation.pr.headRefOid,
    });
    writeInfo(
      `${state.issue.identifier}: CI is green; waiting for owner approval`,
    );
  }
  private async observeApproval(state: TaskState): Promise<void> {
    const observation = await this.observe(state);
    if (observation.kind === "transition") return;
    if (await this.queueUnhealthy(state, observation.health, observation.pr))
      return;
    if (!deliveryHealth.deliveryIsHealthy(observation.health)) {
      await this.save(state, "awaiting_ci", {
        latestHeadSha: observation.pr.headRefOid,
      });
      return;
    }
    const approved = await this.withGitHub(
      async (github) =>
        await github.hasExactHeadApproval(
          observation.pr.number,
          observation.pr.headRefOid,
        ),
    );
    if (!approved) {
      writeInfo(
        `${state.issue.identifier}: waiting for exact-head owner approval`,
      );
      return;
    }
    await this.save(state, "merging", {
      latestHeadSha: observation.pr.headRefOid,
    });
    writeInfo(
      `${state.issue.identifier}: exact-head approval observed; merge queued`,
    );
  }
  private async queueUnhealthy(
    state: TaskState,
    health: PrHealth,
    pr: PullRequest,
  ): Promise<boolean> {
    if (!deliveryHealth.deliveryIsUnhealthy(health)) return false;
    const diagnostics = await reconcileMerge.collectDiagnostics({
      prNumber: pr.number,
      health,
      checkout: state.checkoutPath,
      withGitHub: this.withGitHub.bind(this),
    });
    await this.save(state, "implementing", {
      pendingHealth: health,
      pendingDiagnostics: diagnostics.text,
      pendingCodexFindingKeys: diagnostics.findingKeys,
      latestHeadSha: pr.headRefOid,
    });
    return true;
  }
}
