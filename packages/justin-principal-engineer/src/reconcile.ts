import { implementTask } from "#src/reconcile-implementation.ts";
import * as deliveryHealth from "#src/domain/delivery-health.ts";
import type { Config, PrHealth, TaskState } from "#src/domain/schemas.ts";
import { DockerAgentRunner } from "#src/host/docker.ts";
import { publishTask } from "#src/reconcile-publication.ts";
import { GitWorkspace } from "#src/host/git-workspace.ts";
import { createTaskState } from "#src/host/task-state.ts";
import type { PullRequest } from "#src/integrations/github.ts";
import { githubHost } from "#src/integrations/github-host.ts";
import { LinearClient, providerForIssue } from "#src/integrations/linear.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import { writeInfo } from "#src/runtime/output.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { currentTimestamp } from "#src/runtime/time.ts";
import * as reconcileMerge from "#src/reconcile-merge.ts";
import { failureCountForSave } from "#src/reconcile-state.ts";
import path from "node:path";
import {
  AutonomousBlocker,
  autonomyIssueBlocker,
  isAutonomousIssue,
} from "#src/domain/autonomy.ts";
import { autonomyEnabled } from "#src/host/autonomy-policy.ts";
import { DeliveryAuthorization } from "#src/host/delivery-authorization.ts";
import { handleAutonomousFailure } from "#src/reconcile-autonomy.ts";
export class Reconciler {
  private readonly store: StateStore;
  private readonly linear: LinearClient;
  private readonly git: GitWorkspace;
  private readonly agent: DockerAgentRunner;
  private readonly withGitHub: ReturnType<typeof githubHost>;
  private readonly cliPath: string;
  private readonly authorization: DeliveryAuthorization;
  public constructor(
    private readonly config: Config,
    private readonly paths: RuntimePaths,
    private readonly run: CommandRunner,
    runnerSource?: string,
  ) {
    this.store = new StateStore(paths);
    this.linear = new LinearClient(config.linear.team, run);
    this.git = new GitWorkspace(config, run);
    this.agent = new DockerAgentRunner(config, run, runnerSource);
    this.withGitHub = githubHost(config, paths, run);
    this.authorization = new DeliveryAuthorization({
      config,
      paths,
      run,
      linear: this.linear,
      git: this.git,
      withGitHub: this.withGitHub,
    });
    this.cliPath = path.join(
      runnerSource ??
        path.join(
          config.repository.stableCheckout,
          "packages/justin-principal-engineer",
        ),
      "src/cli.ts",
    );
  }
  public async reconcile(): Promise<void> {
    await this.store.initialize();
    const outcome = await this.store.withLock(async () => {
      await this.reconcileLocked();
      return true;
    });
    if (outcome === undefined) {
      writeInfo("Another reconciler owns the local lock; exiting");
    }
  }
  private async reconcileLocked(): Promise<void> {
    const states = await this.store.list();
    const active = states.find(
      ({ phase }) =>
        phase !== "done" && phase !== "needs_human" && phase !== "blocked",
    );
    if (active !== undefined) {
      await this.advanceSafely(active);
      return;
    }
    const due = states.find(
      (state) =>
        state.phase === "blocked" &&
        state.nextAttemptAt !== null &&
        Date.parse(state.nextAttemptAt) <= Date.now(),
    );
    if (due !== undefined) {
      const issue = await this.linear.refreshIssue(due.issue.identifier);
      if (issue === null) throw new Error("Blocked task's issue disappeared");
      const resumed = {
        ...due,
        issue,
        phase: due.blockedFromPhase ?? due.resumePhase ?? "awaiting_ci",
        resumePhase: due.blockedFromPhase === null ? null : due.resumePhase,
        blockedFromPhase: null,
        nextAttemptAt: null,
      };
      await this.store.save(resumed);
      await this.advanceSafely(resumed);
      return;
    }
    const issue = await this.linear.nextIssue(async (candidate) => {
      const parked = states.some(
        (state) =>
          state.issue.identifier === candidate.identifier &&
          state.phase === "blocked",
      );
      return (
        !parked &&
        (!isAutonomousIssue(candidate) ||
          (autonomyIssueBlocker(candidate) === null &&
            (await autonomyEnabled(candidate, this.paths))))
      );
    });
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
        deliveryMode: isAutonomousIssue(issue)
          ? "autonomous"
          : existing.deliveryMode,
        implementationStarted:
          existing.implementationStarted || existing.prNumber !== null,
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
    const state = createTaskState({
      issue,
      provider,
      paths: this.paths,
      deliveryMode: isAutonomousIssue(issue) ? "autonomous" : "owner_approved",
    });
    await this.store.save(state);
    await this.advanceSafely(state);
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
      if (latest.deliveryMode === "autonomous") {
        await handleAutonomousFailure({
          initial,
          latest,
          error,
          store: this.store,
          linear: this.linear,
          save: this.save.bind(this),
        });
        return;
      }
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
    if (state.deliveryMode === "autonomous" && state.phase !== "completing")
      state = await this.authorization.authorizeAutonomous(state);
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
          ready: () => this.mergeReady(state),
          mergeCommand: [
            process.execPath,
            this.cliPath,
            "merge-ready",
            state.issue.identifier,
            "--runner-source",
            path.dirname(path.dirname(this.cliPath)),
          ],
          confirmMerged: (sha, env) =>
            this.git.confirmMerged(state.checkoutPath, sha, env),
        });
        return;
      case "completing": {
        if (state.deliveryMode === "autonomous" && state.prNumber !== null) {
          const number = state.prNumber;
          const merged = await this.withGitHub(async (github, env) => {
            const pr = await github.pullRequest(number);
            if (pr.mergedAt === null || pr.mergeCommit === null)
              throw new Error("Autonomous task's merge is not confirmed");
            await this.git.confirmMerged(
              state.checkoutPath,
              pr.mergeCommit.oid,
              env,
            );
            return pr.mergeCommit.oid;
          });
          state = await this.save(state, "completing", {
            mergeCommitSha: merged,
          });
        }
        await reconcileMerge.completeTask({
          state,
          linear: this.linear,
          save: this.save.bind(this),
          writeInfo,
        });
        return;
      }
      case "needs_human":
      case "blocked":
      case "done":
        return;
    }
  }
  private async implement(state: TaskState): Promise<void> {
    await implementTask({
      state,
      linear: this.linear,
      git: this.git,
      agent: this.agent,
      store: this.store,
      save: this.save.bind(this),
    });
  }
  private async publish(state: TaskState): Promise<void> {
    await publishTask({
      state,
      authorization: this.authorization,
      git: this.git,
      linear: this.linear,
      agent: this.agent,
      paths: this.paths,
      run: this.run,
      withGitHub: this.withGitHub.bind(this),
      save: this.save.bind(this),
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
      const token = env["WOODPECKER_TOKEN"];
      if (token === undefined)
        throw new Error("Woodpecker token missing from host environment");
      if (
        await reconcileMerge.pauseForCiOperatorBlocker({
          state,
          health,
          pr,
          config: this.config.woodpecker,
          token,
          linear: this.linear,
          store: this.store,
        })
      ) {
        return { kind: "transition" };
      }
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
      if (
        await reconcileMerge.queueUnhealthy({
          state,
          health,
          pr,
          save: this.save.bind(this),
          withGitHub: this.withGitHub.bind(this),
        })
      ) {
        writeInfo(
          `${state.issue.identifier}: CI failure queued for a fresh turn`,
        );
        return { kind: "transition" };
      }
      return { kind: "health", health, pr };
    });
  }
  private async observeCi(state: TaskState): Promise<void> {
    const observation = await this.observe(state);
    if (observation.kind === "transition") return;
    if (!deliveryHealth.deliveryIsHealthy(observation.health)) {
      if (
        state.deliveryMode === "autonomous" &&
        Date.now() - Date.parse(state.updatedAt) >= 60 * 60_000
      )
        throw new AutonomousBlocker(
          "Exact-head CI has remained pending for an hour",
          true,
        );
      writeInfo(`${state.issue.identifier}: CI is still pending`);
      return;
    }
    await this.withGitHub(async (github) => {
      if (observation.pr.isDraft) await github.markReady(observation.pr.number);
    });
    await this.save(
      state,
      state.deliveryMode === "autonomous" ? "merging" : "awaiting_approval",
      {
        latestHeadSha: observation.pr.headRefOid,
      },
    );
    if (state.deliveryMode === "autonomous") {
      writeInfo(
        `${state.issue.identifier}: CI is green; autonomous merge queued`,
      );
      return;
    }
    writeInfo(
      `${state.issue.identifier}: CI is green; waiting for owner approval`,
    );
  }
  private async observeApproval(state: TaskState): Promise<void> {
    const observation = await this.observe(state);
    if (observation.kind === "transition") return;
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

  public async mergeReady(state: TaskState): Promise<boolean> {
    return await this.authorization.mergeReady(state);
  }
}
