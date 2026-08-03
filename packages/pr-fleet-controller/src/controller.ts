import type {
  FleetControllerDependencies,
  FleetEnvironment,
  FleetObserver,
  FleetScheduler,
  WorkerRunner,
} from "./ports.ts";
import { ControllerTelemetry } from "./controller-telemetry.ts";
import {
  buildPrState,
  computeStackIds,
  currentTimestamp,
  mapBounded,
  type RefreshedPr,
} from "./fleet-logic.ts";
import {
  FleetTickReportSchema,
  type FleetControllerConfig,
  type FleetSnapshot,
  type FleetTickReport,
  type PrState,
  type TickTrigger,
  type WorkerResult,
} from "./schemas.ts";
import { FleetStore } from "./state.ts";
import type { MasterControllerTools } from "./master-tools.ts";
import { createFleetTickWorkflow } from "./workflow.ts";
import { defaultFleetScheduler } from "./scheduler.ts";

export class FleetController implements MasterControllerTools {
  readonly #config: FleetControllerConfig;
  readonly #environment: FleetEnvironment;
  readonly #workerRunner: WorkerRunner;
  readonly #observer: FleetObserver;
  readonly #scheduler: FleetScheduler;
  readonly #telemetry: ControllerTelemetry;
  readonly #workflow;
  readonly store: FleetStore;
  #heartbeat: (() => void) | null = null;
  #tickRunning = false;
  #tickDue = false;
  #currentTickId: string | undefined;

  constructor(dependencies: FleetControllerDependencies) {
    const { config, environment, workerRunner, observer } = dependencies;
    this.#config = config;
    this.#environment = environment;
    this.#workerRunner = workerRunner;
    this.#observer = observer;
    this.#telemetry = new ControllerTelemetry(dependencies.telemetry);
    this.#scheduler = dependencies.scheduler ?? defaultFleetScheduler;
    this.store = dependencies.store ?? new FleetStore(config.maxWorkers);
    this.#workflow = createFleetTickWorkflow((trigger) =>
      this.#executeTick(trigger),
    );
  }

  snapshot(): FleetSnapshot {
    return this.store.snapshot();
  }

  async start(): Promise<void> {
    await this.tick("startup");
  }

  async tick(trigger: TickTrigger = "user"): Promise<FleetTickReport> {
    if (this.#tickRunning) {
      this.#tickDue = true;
      this.#telemetry.tickQueued(trigger, this.snapshot(), this.#currentTickId);
      return {
        trigger,
        snapshot: this.snapshot(),
        changes: ["tick queued behind active reconciliation"],
        nextHeartbeatSeconds: 300,
      };
    }
    const tickId = this.#telemetry.tickStarted(trigger);
    this.#currentTickId = tickId;
    this.#tickRunning = true;
    try {
      const run = await this.#workflow.createRun();
      const result = await run.start({ inputData: { trigger } });
      if (result.status !== "success") {
        if (result.status === "failed") {
          throw result.error;
        }
        throw new Error(`Fleet workflow ended with status ${result.status}`);
      }
      const report = FleetTickReportSchema.parse(result.result);
      this.#armHeartbeat(report.nextHeartbeatSeconds);
      this.#telemetry.tickCompleted(tickId, report);
      return report;
    } catch (error) {
      this.#telemetry.tickFailed(tickId, error);
      throw error;
    } finally {
      this.#tickRunning = false;
      this.#currentTickId = undefined;
      if (this.#tickDue && !this.store.stopping) {
        this.#tickDue = false;
        queueMicrotask(() => {
          void this.#runTickSafely("due", "due tick");
        });
      }
    }
  }

  async #executeTick(trigger: TickTrigger): Promise<FleetTickReport> {
    const changes: string[] = [];
    const identities = await this.#environment.listOpenPrs();
    const openNumbers = new Set(identities.map((pr) => pr.number));
    for (const [number, previous] of this.store.prs) {
      if (!openNumbers.has(number) && previous.status !== "closed") {
        this.store.prs.set(number, {
          ...previous,
          status: "closed",
          runtimeAgent: null,
        });
        if (this.store.activeWorkers.has(number)) {
          // Abort the closed PR's worker, but retain leases until settlement so
          // no replacement overlaps its in-flight setup, Git, or publication.
          this.store.cancelledWorkers.add(number);
          this.store.workerControllers.get(number)?.abort();
        } else {
          this.store.releaseLeases(number);
          this.store.workerControllers.delete(number);
        }
        changes.push(`PR #${String(number)} closed or merged`);
      }
    }

    const stackIds = computeStackIds(identities);
    const refreshed = await mapBounded(identities, 5, async (identity) => ({
      identity,
      evidence: await this.#environment.refreshEvidence(identity),
      stackId: stackIds.get(identity.number) ?? `pr-${String(identity.number)}`,
    }));
    this.#reconcileStates(refreshed, changes);
    await this.#dispatch(changes);

    const snapshot = this.snapshot();
    this.#telemetry.snapshot(this.#currentTickId, snapshot);
    this.#observer.onSnapshot(snapshot);
    for (const change of changes) {
      this.#telemetry.change(this.#currentTickId, change);
      this.#observer.onChange(change);
    }
    return {
      trigger,
      snapshot,
      changes,
      nextHeartbeatSeconds:
        snapshot.open === snapshot.green && snapshot.active === 0 ? 600 : 300,
    };
  }

  #reconcileStates(refreshed: RefreshedPr[], changes: string[]): void {
    for (const item of refreshed) {
      const previous = this.store.prs.get(item.identity.number);
      const reconciled = buildPrState(
        item,
        previous,
        this.store.pausedReasons.get(item.identity.number),
        this.#config.model,
      );
      this.store.prs.set(item.identity.number, reconciled.state);
      const headChanged =
        previous !== undefined &&
        previous.identity.headSha !== reconciled.state.identity.headSha;
      if (
        (headChanged || reconciled.state.classification === "green") &&
        this.store.activeWorkers.has(item.identity.number)
      ) {
        // Cancel stale/resolved work deliberately: green stays done and a moved
        // head can redispatch without being converted into a failure pause.
        this.store.cancelledWorkers.add(item.identity.number);
        this.store.workerControllers.get(item.identity.number)?.abort();
      }
      if (reconciled.change !== null) {
        changes.push(reconciled.change);
      }
    }
  }

  async #dispatch(changes: string[]): Promise<void> {
    if (this.store.stopping) {
      return;
    }
    const candidates = [...this.store.prs.values()]
      .filter(
        (pr) =>
          pr.status !== "closed" &&
          ["actionable-red", "conflict"].includes(pr.classification) &&
          !this.store.activeWorkers.has(pr.identity.number),
      )
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.identity.number - right.identity.number,
      );

    const busyStacks = new Set<string>();
    for (const active of this.store.activeWorkers.keys()) {
      const state = this.store.prs.get(active);
      if (state !== undefined) {
        busyStacks.add(state.stackId);
      }
    }

    for (const candidate of candidates) {
      if (this.store.activeWorkers.size >= this.store.workerLimit) {
        this.store.prs.set(candidate.identity.number, {
          ...candidate,
          classification: "queued",
          status: "queued",
        });
        continue;
      }
      if (busyStacks.has(candidate.stackId)) {
        // Only one worker per stack may hold the shared worktree/branch at a
        // time. A sibling PR waits until the active same-stack worker finishes
        // rather than racing it on the same checkout.
        this.store.prs.set(candidate.identity.number, {
          ...candidate,
          classification: "queued",
          status: "queued",
        });
        continue;
      }
      try {
        const siblingBranches = [...this.store.prs.values()]
          .filter((pr) => pr.stackId === candidate.stackId)
          .map((pr) => pr.identity.headRefName);
        const worktree =
          (await this.#environment.findWorktree(siblingBranches)) ??
          (await this.#environment.provisionWorktree(
            candidate.identity,
            candidate.stackId,
          ));
        // Reassign the shared stack worktree to this exact current PR head.
        await this.#environment.assignWorktreeBranch(
          worktree,
          candidate.identity,
        );
        const generation = candidate.agentGeneration + 1;
        const prNumber = String(candidate.identity.number);
        const assigned: PrState = {
          ...candidate,
          worktree,
          // Setup is only current when it ran for this exact head; a reused
          // worktree at a different head must re-run it.
          setupComplete:
            this.store.setupWorktrees.get(worktree) ===
            candidate.identity.headSha,
          agentGeneration: generation,
          runtimeAgent: `pr-${prNumber}-g${String(generation)}`,
          status: "diagnosing",
        };
        this.store.prs.set(candidate.identity.number, assigned);
        const abortController = new AbortController();
        const promise = Promise.resolve().then(() =>
          this.#workerRunner.run(assigned, abortController.signal),
        );
        this.store.activeWorkers.set(candidate.identity.number, promise);
        this.store.workerControllers.set(
          candidate.identity.number,
          abortController,
        );
        this.#telemetry.workerStarted(this.#currentTickId, assigned);
        busyStacks.add(candidate.stackId);
        changes.push(`started ${assigned.runtimeAgent ?? "worker"}`);
        void this.#observeWorker(candidate.identity.number, promise);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pause(candidate.identity.number, message);
        changes.push(
          `paused PR #${String(candidate.identity.number)}: ${message}`,
        );
      }
    }
  }

  async #observeWorker(
    prNumber: number,
    promise: Promise<WorkerResult>,
  ): Promise<void> {
    try {
      const result = await promise;
      // A model result cannot mutate a PR other than its dispatched owner.
      if (result.pr !== prNumber) {
        this.#handleWorkerFailure(
          prNumber,
          new Error(
            `worker returned a result for PR #${String(result.pr)} instead of #${String(prNumber)}`,
          ),
        );
        return;
      }
      this.#handleWorkerResult(prNumber, result);
    } catch (error) {
      this.#handleWorkerFailure(prNumber, error);
    }
  }

  #handleWorkerResult(prNumber: number, result: WorkerResult): void {
    const previous = this.store.prs.get(prNumber);
    this.#telemetry.workerCompleted(prNumber, previous, result);
    this.store.activeWorkers.delete(prNumber);
    this.store.workerControllers.delete(prNumber);
    this.store.cancelledWorkers.delete(prNumber);
    this.store.releaseLeases(prNumber);
    if (previous === undefined) {
      return;
    }
    const needsLease =
      result.state === "needs-setup-lease" ||
      result.state === "needs-heavy-lease" ||
      result.state === "needs-write-lease";
    if (needsLease) {
      // Queue lease contention until settlement/heartbeat, avoiding paid spin.
      this.store.prs.set(prNumber, {
        ...previous,
        runtimeAgent: null,
        status: "queued",
        classification: "queued",
        lastAgentReportAt: currentTimestamp(),
      });
      this.#observer.onChange(
        `worker for PR #${String(prNumber)} deferred: ${result.state} — awaiting lease`,
      );
      return;
    }
    const paused = result.state === "escalation" || result.state === "blocked";
    if (paused) {
      this.store.pausedReasons.set(prNumber, result.blockers.join("; "));
    }
    this.store.prs.set(prNumber, {
      ...previous,
      runtimeAgent: null,
      status: paused
        ? "paused"
        : result.state === "pushed"
          ? "waiting-ci"
          : previous.status,
      classification: paused ? "paused" : previous.classification,
      lastAgentReportAt: currentTimestamp(),
      lastProgressAt: currentTimestamp(),
      noProgressTicks: 0,
      escalation: paused ? result.blockers.join("; ") : null,
    });
    this.#observer.onChange(
      `worker for PR #${String(prNumber)}: ${result.state} — ${result.lastAction}`,
    );
    void this.#runTickSafely("worker-complete", "worker-complete tick");
  }

  #handleWorkerFailure(prNumber: number, error: unknown): void {
    const recordedState = this.store.prs.get(prNumber);
    const deliberatelyCancelled = this.store.cancelledWorkers.delete(prNumber);
    this.store.activeWorkers.delete(prNumber);
    this.store.workerControllers.delete(prNumber);
    this.store.releaseLeases(prNumber);
    if (deliberatelyCancelled) {
      this.#telemetry.workerCancelled(prNumber, recordedState, error);
      // Deliberate cancel (PR went green or its head advanced) — not a failure.
      // Do not pause; re-run a tick so a moved-head PR re-dispatches against its
      // refreshed SHA (a green PR simply won't be a dispatch candidate).
      this.#observer.onChange(
        `worker for PR #${String(prNumber)} cancelled (stale head or resolved)`,
      );
      void this.#runTickSafely("worker-complete", "worker-complete tick");
      return;
    }
    this.#telemetry.workerFailed(prNumber, recordedState, error);
    const message = error instanceof Error ? error.message : String(error);
    const state = this.store.prs.get(prNumber);
    if (
      this.store.stopping ||
      state?.status === "closed" ||
      this.store.pausedReasons.has(prNumber)
    ) {
      // Already stopping, closed, or deliberately paused (which aborts the
      // worker). Don't overwrite the intended pause reason with the abort error.
      this.#observer.onChange(
        `worker for PR #${String(prNumber)} stopped: ${message}`,
      );
      return;
    }
    this.pause(prNumber, `worker failed: ${message}`);
    this.#observer.onChange(
      `worker for PR #${String(prNumber)} failed: ${message}`,
    );
  }

  #armHeartbeat(seconds: 300 | 600): void {
    if (this.store.stopping) {
      return;
    }
    if (this.#heartbeat !== null) {
      this.#heartbeat();
    }
    this.#heartbeat = this.#scheduler.schedule(() => {
      this.#heartbeat = null;
      void this.#runTickSafely("heartbeat", "heartbeat");
    }, seconds * 1000);
  }

  async #runTickSafely(trigger: TickTrigger, label: string): Promise<void> {
    try {
      await this.tick(trigger);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#observer.onChange(`${label} failed: ${message}`);
      // A heartbeat clears its handle before starting the tick. If that tick
      // fails, rearm it so one transient external outage does not permanently
      // stop fleet reconciliation. Other tick triggers retain their timer.
      if (!this.store.stopping && this.#heartbeat === null) {
        this.#armHeartbeat(300);
      }
    }
  }

  prioritize(prNumber: number, priority: number): void {
    const state = this.store.prs.get(prNumber);
    if (state === undefined) {
      throw new Error(`Unknown PR #${String(prNumber)}`);
    }
    this.store.prs.set(prNumber, { ...state, priority });
  }

  pause(prNumber: number, reason: string): void {
    const state = this.store.prs.get(prNumber);
    if (state === undefined) {
      throw new Error(`Unknown PR #${String(prNumber)}`);
    }
    this.store.pausedReasons.set(prNumber, reason);
    // Abort model/publication work, retaining leases until actual settlement so
    // a sibling cannot acquire the shared checkout mid-cancellation.
    if (this.store.activeWorkers.has(prNumber)) {
      this.store.workerControllers.get(prNumber)?.abort();
    } else {
      // No in-flight worker will settle, so release directly.
      this.store.workerControllers.get(prNumber)?.abort();
      this.store.workerControllers.delete(prNumber);
      this.store.releaseLeases(prNumber);
    }
    this.store.prs.set(prNumber, {
      ...state,
      runtimeAgent: null,
      classification: "paused",
      status: "paused",
      escalation: reason,
    });
  }

  resume(prNumber: number): void {
    if (!this.store.prs.has(prNumber)) {
      throw new Error(`Unknown PR #${String(prNumber)}`);
    }
    this.store.pausedReasons.delete(prNumber);
  }

  guide(prNumber: number, message: string): void {
    if (!this.store.prs.has(prNumber)) {
      throw new Error(`Unknown PR #${String(prNumber)}`);
    }
    this.store.addGuidance(prNumber, message);
  }

  setWorkerLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
      throw new Error("Worker limit must be an integer between one and five");
    }
    this.store.workerLimit = limit;
  }

  async stop(): Promise<FleetSnapshot> {
    this.#telemetry.shutdownStarted(this.store.activeWorkers.size);
    this.store.stopping = true;
    if (this.#heartbeat !== null) {
      this.#heartbeat();
      this.#heartbeat = null;
    }
    for (const controller of this.store.workerControllers.values()) {
      controller.abort();
    }
    await Promise.allSettled(this.store.activeWorkers.values());
    const snapshot = this.snapshot();
    this.#telemetry.shutdownCompleted(snapshot);
    return snapshot;
  }
}
