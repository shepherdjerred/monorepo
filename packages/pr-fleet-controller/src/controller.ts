import type {
  FleetControllerDependencies,
  FleetEnvironment,
  FleetObserver,
  WorkerRunner,
} from "./ports.ts";
import {
  classify,
  computeStackIds,
  currentTimestamp,
  statusFor,
  type RefreshedPr,
} from "./fleet-logic.ts";
import {
  FleetTickReportSchema,
  type Classification,
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

async function mapBounded<T, U>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await operation(value);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

function buildPrState(
  item: RefreshedPr,
  previous: PrState | undefined,
  pausedReason: string | undefined,
  model: string,
): { state: PrState; change: string | null } {
  const classification = classify(
    item.identity,
    item.evidence,
    pausedReason !== undefined,
  );
  const changedHead =
    previous !== undefined &&
    previous.identity.headSha !== item.identity.headSha;
  const changedClassification =
    previous !== undefined && previous.classification !== classification;
  const madeProgress = changedHead || changedClassification;
  const timestamp = currentTimestamp();
  const prNumber = String(item.identity.number);
  const retained = retainedPrState(previous, madeProgress, timestamp);
  const state: PrState = {
    identity: item.identity,
    logicalOwner: `pr-${prNumber}`,
    ...retained,
    model,
    status: statusFor(classification),
    classification,
    stackId: item.stackId,
    evidence: item.evidence,
    escalation: pausedReason ?? retained.escalation,
  };
  return { state, change: describeStateChange(previous, item, classification) };
}

function retainedPrState(
  previous: PrState | undefined,
  madeProgress: boolean,
  timestamp: string,
): Pick<
  PrState,
  | "runtimeAgent"
  | "agentGeneration"
  | "worktree"
  | "setupComplete"
  | "lastAgentReportAt"
  | "lastProgressAt"
  | "noProgressTicks"
  | "prodSentAt"
  | "escalation"
  | "priority"
> {
  if (previous === undefined) {
    return {
      runtimeAgent: null,
      agentGeneration: 0,
      worktree: null,
      setupComplete: false,
      lastAgentReportAt: null,
      lastProgressAt: timestamp,
      noProgressTicks: 0,
      prodSentAt: null,
      escalation: null,
      priority: 0,
    };
  }
  return {
    runtimeAgent: previous.runtimeAgent,
    agentGeneration: previous.agentGeneration,
    worktree: previous.worktree,
    setupComplete: previous.setupComplete,
    lastAgentReportAt: previous.lastAgentReportAt,
    lastProgressAt: madeProgress ? timestamp : previous.lastProgressAt,
    noProgressTicks: madeProgress ? 0 : previous.noProgressTicks + 1,
    prodSentAt: previous.prodSentAt,
    escalation: previous.escalation,
    priority: previous.priority,
  };
}

function describeStateChange(
  previous: PrState | undefined,
  item: RefreshedPr,
  classification: Classification,
): string | null {
  const prNumber = String(item.identity.number);
  if (previous === undefined) {
    return `discovered PR #${prNumber}`;
  }
  if (previous.identity.headSha !== item.identity.headSha) {
    return `PR #${prNumber} head changed to ${item.identity.headSha}`;
  }
  return previous.classification === classification
    ? null
    : `PR #${prNumber} ${previous.classification} -> ${classification}`;
}

export class FleetController implements MasterControllerTools {
  readonly #config: FleetControllerConfig;
  readonly #environment: FleetEnvironment;
  readonly #workerRunner: WorkerRunner;
  readonly #observer: FleetObserver;
  readonly #workflow;
  readonly store: FleetStore;
  #heartbeat: ReturnType<typeof setTimeout> | null = null;
  #tickRunning = false;
  #tickDue = false;

  constructor(dependencies: FleetControllerDependencies) {
    const { config, environment, workerRunner, observer } = dependencies;
    this.#config = config;
    this.#environment = environment;
    this.#workerRunner = workerRunner;
    this.#observer = observer;
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
      return {
        trigger,
        snapshot: this.snapshot(),
        changes: ["tick queued behind active reconciliation"],
        nextHeartbeatSeconds: 300,
      };
    }
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
      return report;
    } finally {
      this.#tickRunning = false;
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
        this.store.releaseLeases(number);
        this.store.workerControllers.get(number)?.abort();
        this.store.workerControllers.delete(number);
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
    this.#observer.onSnapshot(snapshot);
    for (const change of changes) {
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
      if (
        reconciled.state.classification === "green" &&
        this.store.activeWorkers.has(item.identity.number)
      ) {
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
          ["actionable-red", "conflict"].includes(pr.classification) &&
          !this.store.activeWorkers.has(pr.identity.number),
      )
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.identity.number - right.identity.number,
      );

    for (const candidate of candidates) {
      if (this.store.activeWorkers.size >= this.store.workerLimit) {
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
        const generation = candidate.agentGeneration + 1;
        const prNumber = String(candidate.identity.number);
        const assigned: PrState = {
          ...candidate,
          worktree,
          setupComplete:
            candidate.setupComplete || this.store.setupWorktrees.has(worktree),
          agentGeneration: generation,
          runtimeAgent: `pr-${prNumber}-g${String(generation)}`,
          status: "diagnosing",
        };
        this.store.prs.set(candidate.identity.number, assigned);
        const abortController = new AbortController();
        const promise = this.#workerRunner.run(
          assigned,
          abortController.signal,
        );
        this.store.activeWorkers.set(candidate.identity.number, promise);
        this.store.workerControllers.set(
          candidate.identity.number,
          abortController,
        );
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
      this.#handleWorkerResult(await promise);
    } catch (error) {
      this.#handleWorkerFailure(prNumber, error);
    }
  }

  #handleWorkerResult(result: WorkerResult): void {
    const previous = this.store.prs.get(result.pr);
    this.store.activeWorkers.delete(result.pr);
    this.store.workerControllers.delete(result.pr);
    this.store.releaseLeases(result.pr);
    if (previous === undefined) {
      return;
    }
    const paused = result.state === "escalation" || result.state === "blocked";
    if (paused) {
      this.store.pausedReasons.set(result.pr, result.blockers.join("; "));
    }
    this.store.prs.set(result.pr, {
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
      `worker for PR #${String(result.pr)}: ${result.state} — ${result.lastAction}`,
    );
    void this.#runTickSafely("worker-complete", "worker-complete tick");
  }

  #handleWorkerFailure(prNumber: number, error: unknown): void {
    this.store.activeWorkers.delete(prNumber);
    this.store.workerControllers.delete(prNumber);
    this.store.releaseLeases(prNumber);
    const message = error instanceof Error ? error.message : String(error);
    const state = this.store.prs.get(prNumber);
    if (this.store.stopping || state?.status === "closed") {
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
      clearTimeout(this.#heartbeat);
    }
    this.#heartbeat = setTimeout(() => {
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
    this.store.prs.set(prNumber, {
      ...state,
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
    this.store.stopping = true;
    if (this.#heartbeat !== null) {
      clearTimeout(this.#heartbeat);
      this.#heartbeat = null;
    }
    for (const controller of this.store.workerControllers.values()) {
      controller.abort();
    }
    await Promise.allSettled(this.store.activeWorkers.values());
    return this.snapshot();
  }
}
