import {
  MAX_OPEN_PULL_REQUESTS,
  type Config,
  type TaskState,
  type TrackerIssue,
} from "#src/domain/schemas.ts";
import {
  autonomyIssueBlocker,
  isAutonomousIssue,
} from "#src/domain/autonomy.ts";
import { autonomyEnabled } from "#src/host/autonomy-policy.ts";
import { createTaskState } from "#src/host/task-state.ts";
import { checkOpenAi } from "#src/integrations/preflight.ts";
import {
  compareIssuePriority,
  isEligibleIssue,
  providerForIssue,
  type TrackerClient,
} from "#src/integrations/tracker.ts";
import type { WithGitHub } from "#src/reconcile-merge.ts";
import { preparePassedRetry } from "#src/reconcile-pass.ts";
import { writeInfo } from "#src/runtime/output.ts";
import type { RuntimePaths } from "#src/runtime/paths.ts";
import type { CommandRunner } from "#src/runtime/process.ts";
import type { StateStore } from "#src/runtime/state-store.ts";
import type { JustinTelemetry } from "#src/runtime/telemetry.ts";

function waitingForPr(state: TaskState): boolean {
  return state.phase === "awaiting_ci" || state.phase === "awaiting_approval";
}

function readyForCleanup(state: TaskState): boolean {
  return ["merging", "completing", "passing"].includes(state.phase);
}

export class QueueScheduler {
  public constructor(
    private readonly input: {
      store: StateStore;
      tracker: TrackerClient;
      config: Config;
      paths: RuntimePaths;
      run: CommandRunner;
      telemetry: JustinTelemetry | undefined;
      withGitHub: WithGitHub;
      save: (
        state: TaskState,
        phase: TaskState["phase"],
        patch?: Partial<TaskState>,
      ) => Promise<TaskState>;
      advanceSafely: (state: TaskState) => Promise<void>;
    },
  ) {}
  public async reconcileLocked(): Promise<void> {
    const states = await this.input.store.list();
    this.input.telemetry?.snapshot(states);
    const waiting = states.filter((task) => waitingForPr(task));
    for (const state of waiting) await this.input.advanceSafely(state);

    const ready = states.find((task) => readyForCleanup(task));
    if (ready !== undefined) {
      await this.input.advanceSafely(ready);
      return;
    }
    // Give newly approved merges the next tick before entering a long turn.
    if (waiting.length > 0) {
      const observed = await this.input.store.list();
      if (observed.some((task) => readyForCleanup(task))) return;
    }
    const openPrs = await this.input.withGitHub((github) =>
      github.openPullRequestNumbers(),
    );
    this.input.telemetry?.queue({ openPrs: openPrs.length });
    const atCapacity = openPrs.length >= MAX_OPEN_PULL_REQUESTS;
    if (atCapacity && this.input.telemetry !== undefined) {
      const listed = await this.listedCandidates(states);
      this.input.telemetry.queue({ eligible: listed.length });
    }
    if (await this.advanceActiveTask(states, openPrs, atCapacity)) return;
    if (atCapacity) {
      this.input.telemetry?.decision("at_capacity");
      writeInfo("Queue is waiting for an open PR slot");
      return;
    }
    await this.claimNext(states);
  }
  private async advanceActiveTask(
    states: TaskState[],
    openPrs: number[],
    atCapacity: boolean,
  ): Promise<boolean> {
    for (const state of states) {
      const due =
        state.phase === "blocked" &&
        state.nextAttemptAt !== null &&
        Date.parse(state.nextAttemptAt) <= Date.now();
      const active = [
        "claiming",
        "claimed",
        "implementing",
        "publishing",
      ].includes(state.phase);
      if (!due && !active) continue;
      if (atCapacity && !(await this.hasOpenPullRequest(state, openPrs)))
        continue;
      await this.input.advanceSafely(
        due ? await this.resumeBlocked(state) : state,
      );
      return true;
    }
    return false;
  }
  private async hasOpenPullRequest(state: TaskState, openPrs: number[]) {
    if (state.prNumber !== null) return openPrs.includes(state.prNumber);
    if (state.phase !== "publishing" && state.blockedFromPhase !== "publishing")
      return false;
    // A submit may have reached GitHub before the host saved the PR number.
    return await this.input.withGitHub(async (github) => {
      const pr = await github.pullRequestForBranch(state.branch);
      return pr !== null && openPrs.includes(pr.number);
    });
  }
  private async resumeBlocked(state: TaskState): Promise<TaskState> {
    const issue = await this.input.tracker.refreshIssue(state.issue.identifier);
    if (issue === null) throw new Error("Blocked task's issue disappeared");
    const resumed: TaskState = {
      ...state,
      issue,
      phase: state.blockedFromPhase ?? state.resumePhase ?? "awaiting_ci",
      resumePhase: state.blockedFromPhase === null ? null : state.resumePhase,
      blockedFromPhase: null,
      nextAttemptAt: null,
    };
    await this.input.store.save(resumed);
    return resumed;
  }
  private async listedCandidates(states: TaskState[]): Promise<TrackerIssue[]> {
    const excluded = new Set(
      states
        .filter(({ phase }) => phase !== "needs_human")
        .map(({ issue }) => issue.identifier),
    );
    const listed = await this.input.tracker.listCandidates();
    return listed.filter(({ identifier }) => !excluded.has(identifier));
  }
  private async claimNext(states: TaskState[]): Promise<void> {
    const known = new Map(
      states.map((state) => [state.issue.identifier, state]),
    );
    const candidates = await this.listedCandidates(states);
    for (const state of states) {
      if (state.phase !== "passed") continue;
      const retry = await preparePassedRetry(state, this.input.tracker);
      if (retry !== null) candidates.push(retry.issue);
    }
    this.input.telemetry?.queue({ eligible: candidates.length });
    for (const listedIssue of candidates.sort(compareIssuePriority)) {
      const existing = known.get(listedIssue.identifier);
      const retryPassed = existing?.phase === "passed";
      const fresh = await this.input.tracker.refreshIssue(
        listedIssue.identifier,
      );
      if (
        fresh === null ||
        !(await this.mayClaim(fresh, retryPassed, existing?.intake))
      )
        continue;
      if (compareIssuePriority(fresh, listedIssue) !== 0) return;
      // Only check model access when there is new work to claim. PR monitoring
      // and approved merges remain available during provider outages.
      try {
        await checkOpenAi(this.input.config, this.input.run);
      } catch (error) {
        this.input.telemetry?.decision("external_block");
        throw error;
      }
      const state = await this.prepareClaim({
        issue: fresh,
        existing,
        intake: providerForIssue(fresh) === undefined ? "automatic" : "handoff",
      });
      this.input.telemetry?.decision("candidate_selected", state);
      await this.input.advanceSafely(state);
      return;
    }
    this.input.telemetry?.decision("empty");
    writeInfo("Queue is quiet: no eligible Tracker issue");
  }
  private async mayClaim(
    issue: TrackerIssue,
    retryPassed: boolean,
    intake: TaskState["intake"],
  ): Promise<boolean> {
    return (
      isEligibleIssue(issue, retryPassed) &&
      (intake !== "automatic" || issue.assigneeId === null) &&
      (!isAutonomousIssue(issue) ||
        (autonomyIssueBlocker(issue, retryPassed) === null &&
          (await autonomyEnabled(issue, this.input.paths))))
    );
  }
  private async prepareClaim(input: {
    issue: TrackerIssue;
    existing: TaskState | undefined;
    intake: NonNullable<TaskState["intake"]>;
  }): Promise<TaskState> {
    const { issue, existing, intake } = input;
    if (existing !== undefined) {
      if (existing.phase !== "needs_human" && existing.phase !== "passed")
        throw new Error("Only parked work can be claimed again");
      return await this.input.save(existing, "claiming", {
        issue,
        claimFromPhase: existing.phase,
      });
    }
    const state = createTaskState({
      issue,
      provider: "codex",
      paths: this.input.paths,
      deliveryMode: isAutonomousIssue(issue) ? "autonomous" : "owner_approved",
    });
    return await this.input.save(state, "claiming", { intake });
  }
  private async discardClaim(state: TaskState): Promise<void> {
    if (state.claimFromPhase !== undefined) {
      const { claimFromPhase, ...unclaimed } = state;
      await this.input.save(unclaimed, claimFromPhase);
    } else if (state.intake === undefined) {
      await this.input.save(state, "needs_human");
    } else {
      await this.input.store.discardClaim(state);
    }
  }
  public async advanceClaim(state: TaskState): Promise<void> {
    const fresh = await this.input.tracker.refreshIssue(state.issue.identifier);
    const retryPassed = state.claimFromPhase === "passed";
    if (
      fresh === null ||
      !(await this.mayClaim(fresh, retryPassed, state.intake))
    ) {
      await this.discardClaim(state);
      return;
    }
    const legacyClaim =
      state.intake === undefined && state.claimFromPhase === undefined;
    const claimed = await this.claimRevision(
      legacyClaim ? fresh : state.issue,
      fresh,
      retryPassed,
    );
    if (claimed === null) {
      await this.discardClaim(state);
      return;
    }
    const deliveryMode = isAutonomousIssue(claimed)
      ? "autonomous"
      : "owner_approved";
    const autonomyReviewPending =
      state.autonomyReviewPending ||
      (state.claimFromPhase === "needs_human" &&
        deliveryMode === "autonomous" &&
        state.prNumber !== null);
    await this.input.save(
      state,
      retryPassed ? "implementing" : (state.resumePhase ?? "claimed"),
      {
        claimFromPhase: undefined,
        issue: claimed,
        deliveryMode,
        resumePhase: null,
        autonomyReviewPending: !retryPassed && autonomyReviewPending,
        ...(retryPassed
          ? { implementationStarted: false, repairTurnsUsed: 0 }
          : {}),
      },
    );
    writeInfo(`Claimed ${claimed.identifier} for ${state.provider}`);
  }
  private async claimRevision(
    selected: TrackerIssue,
    fresh: TrackerIssue,
    retryPassed: boolean,
  ): Promise<TrackerIssue | null> {
    if (selected.revision === undefined || selected.revision === fresh.revision)
      return await this.input.tracker.claim(fresh, {
        retryPassed,
        requireRevision: true,
      });
    // Recover a successful CAS even if the host exited before writing claimed.
    const applied =
      fresh.state.type === "started" &&
      providerForIssue(fresh) !== undefined &&
      isEligibleIssue(fresh) &&
      (await this.input.tracker.claimPreviouslyApplied(selected));
    return applied ? fresh : null;
  }
}
