import { implementTask } from "#src/reconcile-implementation.ts";
import * as deliveryHealth from "#src/domain/delivery-health.ts";
import type { Config, PrHealth, TaskState } from "#src/domain/schemas.ts";
import {
  DockerAgentRunner,
  WorkspaceVerificationFailure,
} from "#src/host/docker.ts";
import { publishTask } from "#src/reconcile-publication.ts";
import { GitWorkspace } from "#src/host/git-workspace.ts";
import { retryBlockedTask } from "#src/host/task-retry.ts";
import type { PullRequest } from "#src/integrations/github-pull-request.ts";
import { githubHost } from "#src/integrations/github-host.ts";
import { checkGitHubAccess } from "#src/integrations/github-access.ts";
import { createTrackerClient } from "#src/integrations/tracker.ts";
import type { TrackerClient } from "#src/integrations/tracker.ts";
import { runnerCli, type RuntimePaths } from "#src/runtime/paths.ts";
import { writeInfo } from "#src/runtime/output.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { currentTimestamp } from "#src/runtime/time.ts";
import * as reconcileMerge from "#src/reconcile-merge.ts";
import { failureCountForSave } from "#src/reconcile-state.ts";
import path from "node:path";
import { AutonomousBlocker } from "#src/domain/autonomy.ts";
import { DeliveryAuthorization } from "#src/host/delivery-authorization.ts";
import { handleAutonomousFailure } from "#src/reconcile-autonomy.ts";
import {
  needsAutonomyReview,
  queueAutonomyReview,
} from "#src/reconcile-promotion.ts";
import { finishPass, privateEvidence } from "#src/reconcile-pass.ts";
import { QueueScheduler } from "#src/reconcile-queue.ts";
import type { JustinTelemetry } from "#src/runtime/telemetry.ts";

export class Reconciler {
  private readonly store: StateStore;
  private readonly tracker: TrackerClient;
  private readonly git: GitWorkspace;
  private readonly agent: DockerAgentRunner;
  private readonly withGitHub: ReturnType<typeof githubHost>;
  private readonly cliPath: string;
  private readonly authorization: DeliveryAuthorization;
  private readonly queue: QueueScheduler;
  private readonly telemetry: JustinTelemetry | undefined;
  public constructor(
    private readonly config: Config,
    private readonly paths: RuntimePaths,
    private readonly run: CommandRunner,
    options?: {
      runnerSource?: string | undefined;
      telemetry?: JustinTelemetry | undefined;
    },
  ) {
    const { runnerSource, telemetry } = options ?? {};
    this.telemetry = telemetry;
    this.store = new StateStore(paths);
    this.tracker = createTrackerClient(config, run);
    this.git = new GitWorkspace(config, run);
    this.agent = new DockerAgentRunner(config, run, runnerSource, telemetry);
    this.withGitHub = githubHost(config, paths, run);
    this.authorization = new DeliveryAuthorization({
      config,
      paths,
      run,
      tracker: this.tracker,
      git: this.git,
      withGitHub: this.withGitHub,
    });
    this.cliPath = runnerCli(config.repository.stableCheckout, runnerSource);
    this.queue = new QueueScheduler({
      config,
      paths,
      run,
      telemetry,
      store: this.store,
      tracker: this.tracker,
      withGitHub: this.withGitHub,
      save: this.save.bind(this),
      advanceSafely: this.advanceSafely.bind(this),
    });
  }
  public async reconcile(): Promise<void> {
    await this.store.initialize();
    const outcome = await this.store.withLock(async () => {
      await this.telemetry?.begin();
      let result: "success" | "failure" = "failure";
      try {
        await checkGitHubAccess({
          config: this.config,
          paths: this.paths,
          run: this.run,
        });
        await this.queue.reconcileLocked();
        result = "success";
        return true;
      } finally {
        if (this.telemetry !== undefined) {
          try {
            await this.telemetry.finish(result, await this.store.list());
          } catch {
            console.error("Justin could not record reconcile telemetry");
          }
        }
      }
    });
    if (outcome === undefined) {
      writeInfo("Another reconciler owns the local lock; exiting");
    }
  }
  private async advanceSafely(initial: TaskState): Promise<void> {
    try {
      if (this.telemetry === undefined) await this.advance(initial);
      else
        await this.telemetry.stage(initial.phase, initial, () =>
          this.advance(initial),
        );
    } catch (error) {
      const states = await this.store.list();
      const latest =
        states.find(
          ({ issue }) => issue.identifier === initial.issue.identifier,
        ) ?? initial;
      if (latest.phase === "passing") {
        console.error(
          `${latest.issue.identifier}: pass will resume on the next reconcile`,
        );
        return;
      }
      if (error instanceof WorkspaceVerificationFailure) {
        await this.save(latest, "implementing", {
          pendingDiagnostics: privateEvidence(error.message),
        });
        writeInfo(
          `${latest.issue.identifier}: host verification repair queued`,
        );
        return;
      }
      if (latest.deliveryMode === "autonomous") {
        await handleAutonomousFailure({
          initial,
          latest,
          error,
          store: this.store,
          tracker: this.tracker,
          save: this.save.bind(this),
        });
        return;
      }
      await reconcileMerge.recordFailure({
        state: latest,
        error,
        tracker: this.tracker,
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
    const newClaim =
      state.phase === "claiming" &&
      (state.intake !== undefined || state.claimFromPhase !== undefined);
    if (
      !newClaim &&
      state.deliveryMode === "autonomous" &&
      !["completing", "passing"].includes(state.phase)
    )
      state = await this.authorization.authorizeAutonomous(state);
    if (needsAutonomyReview(state)) {
      await queueAutonomyReview({
        state,
        baseBranch: this.config.repository.baseBranch,
        git: this.git,
        withGitHub: this.withGitHub.bind(this),
        save: this.save.bind(this),
      });
      return;
    }
    switch (state.phase) {
      case "claiming":
        await this.queue.advanceClaim(state);
        return;
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
          tracker: this.tracker,
          save: this.save.bind(this),
          writeInfo,
          baseBranch: this.config.repository.baseBranch,
          store: this.store,
          ready: () => this.mergeReady(state),
          mergeCommand: [
            process.execPath,
            this.cliPath,
            "merge-ready",
            state.issue.identifier,
            "--runner-source",
            path.dirname(path.dirname(this.cliPath)),
          ],
          restackTask: (input) =>
            reconcileMerge.restackStaleMergeTask({
              ...input,
              git: this.git,
              telemetry: this.telemetry,
              save: this.save.bind(this),
              writeInfo,
            }),
          confirmMerged: (sha, env) =>
            this.git.confirmMerged(state.checkoutPath, sha, env),
        });
        return;
      case "completing":
        await this.complete(state);
        return;
      case "needs_human":
      case "blocked":
      case "passed":
      case "done":
        return;
      case "passing":
        await finishPass({
          state,
          tracker: this.tracker,
          withGitHub: this.withGitHub,
          store: this.store,
          baseBranch: this.config.repository.baseBranch,
        });
        return;
    }
  }
  private async complete(initial: TaskState): Promise<void> {
    let state = initial;
    if (initial.prNumber !== null && initial.mergeCommitSha === null) {
      const number = initial.prNumber;
      const merged = await this.withGitHub(async (github, env) => {
        const pr = await github.pullRequest(number);
        this.assertTaskPullRequest(initial, pr);
        if (pr.state !== "MERGED" || pr.mergeCommit === null)
          throw new Error("Task's merge is not confirmed");
        await this.git.confirmMerged(
          initial.checkoutPath,
          pr.mergeCommit.oid,
          env,
        );
        return pr.mergeCommit.oid;
      });
      state = await this.save(initial, "completing", {
        mergeCommitSha: merged,
      });
    }
    await reconcileMerge.completeTask({
      state,
      tracker: this.tracker,
      save: this.save.bind(this),
      writeInfo,
    });
  }
  private async implement(state: TaskState): Promise<void> {
    await implementTask({
      state,
      tracker: this.tracker,
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
      tracker: this.tracker,
      agent: this.agent,
      paths: this.paths,
      run: this.run,
      baseBranch: this.config.repository.baseBranch,
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
      if (await this.observeTerminalPullRequest(state, pr))
        return { kind: "transition" };
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
          tracker: this.tracker,
          store: this.store,
        })
      ) {
        return { kind: "transition" };
      }
      if (deliveryHealth.deliveryNeedsRestack(health)) {
        await this.restackTask(state, pr, health, env);
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
  private async restackTask(
    state: TaskState,
    pr: PullRequest,
    health: PrHealth,
    env: Readonly<Record<string, string>>,
  ) {
    const conflict = await this.git.restack(state.checkoutPath, env);
    await this.save(state, conflict === null ? "publishing" : "implementing", {
      pendingHealth: conflict === null ? null : health,
      pendingDiagnostics: conflict,
      restackInProgress: conflict !== null,
      latestHeadSha: pr.headRefOid,
      ...(conflict === null
        ? { evidencePublished: false, evidenceMarkdown: [] }
        : {}),
    });
    writeInfo(
      `${state.issue.identifier}: ${conflict === null ? "restacked on current main" : "restack conflicts queued for a fresh turn"}`,
    );
  }
  private async observeTerminalPullRequest(state: TaskState, pr: PullRequest) {
    this.assertTaskPullRequest(state, pr);
    if (pr.state === "OPEN") return false;
    if (pr.state === "MERGED")
      await this.save(state, "completing", { latestHeadSha: pr.headRefOid });
    else
      await reconcileMerge.pauseTask({
        state,
        reason: "The pull request was closed. Reopen it before requeueing.",
        tracker: this.tracker,
        store: this.store,
      });
    return true;
  }
  private assertTaskPullRequest(state: TaskState, pr: PullRequest) {
    if (
      pr.baseRefName !== this.config.repository.baseBranch ||
      pr.headRefName !== state.branch
    )
      throw new Error(
        "The pull request no longer matches the task branch and base",
      );
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
      this.telemetry?.decision("awaiting_ci", state);
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
          state.previousApprovalIds,
        ),
    );
    if (!approved) {
      this.telemetry?.decision("awaiting_approval", state);
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
  public mergeReady(state: TaskState): Promise<boolean> {
    return this.authorization.mergeReady(state);
  }
  public async retryTask(identifier: string): Promise<void> {
    await retryBlockedTask({
      identifier,
      paths: this.paths,
      store: this.store,
      tracker: this.tracker,
      checkScope: this.authorization.checkAutonomousScope.bind(
        this.authorization,
      ),
    });
  }
}
