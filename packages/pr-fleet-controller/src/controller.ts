import type {
  FleetControllerDependencies,
  FleetEnvironment,
  FleetObserver,
  FleetScheduler,
  WorkerRunner,
} from "./ports.ts";
import {
  ControllerTelemetry,
  isTelemetryCaptureError,
} from "./controller-telemetry.ts";
import {
  FleetTickReportSchema,
  type FleetControllerConfig,
  type FleetSnapshot,
  type FleetTickReport,
  type OperatorInputAnswer,
  type OperatorInputRequest,
  type PrState,
  type TickTrigger,
  type WorkerResult,
} from "./schemas.ts";
import { FleetStore } from "./state.ts";
import type { MasterControllerTools } from "./master-tools.ts";
import { createFleetTickWorkflow } from "./workflow.ts";
import { defaultFleetScheduler } from "./scheduler.ts";
import {
  assignFleetWorktree,
  withTickCommandCorrelation,
} from "./controller-correlation.ts";
import {
  settleWorkerFailure,
  settleWorkerResult,
} from "./controller-worker-settlement.ts";
import { startWorkerObservation } from "./controller-worker-observer.ts";
import {
  guidePr,
  pausePr,
  prioritizePr,
  resumePr,
  updateWorkerLimit,
} from "./controller-commands.ts";
import {
  abortFleetWorkers,
  settleControllerShutdown,
} from "./controller-shutdown.ts";
import { busyStackIds } from "./controller-dispatch.ts";
import {
  acceptOperatorAnswer,
  acceptOperatorTextAnswer,
  listOperatorQuestions,
} from "./controller-operator-questions.ts";
import {
  closeMissingPrStates,
  reconcilePrStates,
} from "./controller-reconciliation.ts";
import { refreshFleetEvidence } from "./controller-evidence-refresh.ts";
import { withoutCommandCorrelation } from "./command-correlation.ts";

export class FleetController implements MasterControllerTools {
  readonly #config: FleetControllerConfig;
  readonly #environment: FleetEnvironment;
  readonly #workerRunner: WorkerRunner;
  readonly #observer: FleetObserver;
  readonly #scheduler: FleetScheduler;
  readonly #telemetry: ControllerTelemetry;
  readonly #onFatalError: ((error: Error) => void) | undefined;
  readonly #workflow;
  readonly store: FleetStore;
  #heartbeat: (() => void) | null = null;
  #tickRunning = false;
  #tickDue = false;
  #currentTickId: string | undefined;
  #tickSettled: Promise<undefined> | null = null;
  readonly #workerSettlements = new Map<Promise<WorkerResult>, Promise<void>>();
  readonly #dispatchedWorkers = new Map<number, PrState>();
  readonly #dispatchedTickIds = new Map<number, string>();
  #fatalFailure: Error | undefined;

  constructor(dependencies: FleetControllerDependencies) {
    const { config, environment, workerRunner, observer } = dependencies;
    this.#config = config;
    this.#environment = environment;
    this.#workerRunner = workerRunner;
    this.#observer = observer;
    this.#telemetry = new ControllerTelemetry(dependencies.telemetry);
    this.#onFatalError = dependencies.onFatalError;
    this.#scheduler = dependencies.scheduler ?? defaultFleetScheduler;
    this.store = dependencies.store ?? new FleetStore(config.maxWorkers);
    this.#workflow = createFleetTickWorkflow((trigger) =>
      this.#executeTick(trigger),
    );
  }

  snapshot(): FleetSnapshot {
    return this.store.snapshot();
  }

  questions(): OperatorInputRequest[] {
    return listOperatorQuestions(this.store);
  }

  answerOperatorQuestion(
    rawAnswer: OperatorInputAnswer,
  ): Promise<FleetTickReport> {
    return Promise.resolve(
      acceptOperatorAnswer(rawAnswer, this.#operatorQuestionDependencies()),
    );
  }

  answerOperatorQuestionWithText(
    requestId: string,
    text: string,
  ): Promise<FleetTickReport> {
    return Promise.resolve(
      acceptOperatorTextAnswer(
        requestId,
        text,
        this.#operatorQuestionDependencies(),
      ),
    );
  }

  #operatorQuestionDependencies() {
    return {
      store: this.store,
      telemetry: this.#telemetry,
      observer: this.#observer,
      queueReconciliation: () => {
        queueMicrotask(() => {
          void this.#runTickSafely("user", "operator-answer tick");
        });
      },
    };
  }

  async start(): Promise<void> {
    await this.tick("startup");
  }

  async tick(trigger: TickTrigger = "user"): Promise<FleetTickReport> {
    if (this.store.stopping) {
      throw new Error("Controller is stopping and cannot start another tick");
    }
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
    const settlement = Promise.withResolvers<undefined>();
    this.#tickSettled = settlement.promise;
    this.#currentTickId = tickId;
    this.#tickRunning = true;
    try {
      let report: FleetTickReport;
      try {
        const run = await this.#workflow.createRun();
        const result = await withTickCommandCorrelation(tickId, () =>
          run.start({ inputData: { trigger } }),
        );
        if (result.status !== "success") {
          if (result.status === "failed") {
            throw result.error;
          }
          throw new Error(`Fleet workflow ended with status ${result.status}`);
        }
        report = FleetTickReportSchema.parse(result.result);
      } catch (error) {
        if (isTelemetryCaptureError(error)) throw error;
        this.#telemetry.tickFailed(tickId, error);
        throw error;
      }
      this.#telemetry.snapshot(tickId, report.snapshot);
      for (const change of report.changes) {
        this.#telemetry.change(tickId, change);
      }
      this.#armHeartbeat(report.nextHeartbeatSeconds);
      this.#telemetry.tickCompleted(tickId, report);
      return report;
    } catch (error) {
      if (isTelemetryCaptureError(error)) {
        this.#reportFatalError(error);
      }
      throw error;
    } finally {
      this.#tickRunning = false;
      this.#currentTickId = undefined;
      settlement.resolve(undefined);
      if (this.#tickSettled === settlement.promise) {
        this.#tickSettled = null;
      }
      if (
        this.#tickDue &&
        !this.store.isStopping() &&
        this.#fatalFailure === undefined
      ) {
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
    closeMissingPrStates(openNumbers, changes, {
      store: this.store,
      telemetry: this.#telemetry,
    });

    const refreshed = await refreshFleetEvidence({
      identities,
      environment: this.#environment,
      changes,
      onHeadChanged: () => {
        this.#tickDue = true;
      },
    });
    reconcilePrStates(refreshed, changes, {
      store: this.store,
      telemetry: this.#telemetry,
      model: this.#config.model,
    });
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

    const busyStacks = busyStackIds(this.store);

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
        this.store.prs.set(candidate.identity.number, {
          ...candidate,
          classification: "queued",
          status: "queued",
        });
        continue;
      }
      let assignment: Awaited<ReturnType<typeof assignFleetWorktree>>;
      try {
        assignment = await assignFleetWorktree(
          this.#environment,
          this.store.prs.values(),
          candidate,
        );
      } catch (error) {
        if (isTelemetryCaptureError(error)) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.pause(candidate.identity.number, message);
        changes.push(
          `paused PR #${String(candidate.identity.number)}: ${message}`,
        );
        continue;
      }
      const { worktree, context: worktreeContext } = assignment;
      const generation = candidate.agentGeneration + 1;
      const prNumber = String(candidate.identity.number);
      const assigned: PrState = {
        ...candidate,
        worktree,
        worktreeContext,
        setupComplete:
          this.store.setupWorktrees.get(worktree) ===
          candidate.identity.headSha,
        agentGeneration: generation,
        runtimeAgent: `pr-${prNumber}-g${String(generation)}`,
        status: "diagnosing",
      };
      const dispatchTickId = this.#currentTickId;
      // Mandatory capture is outside the worktree-provisioning catch. Failure
      // must stop the tick before state says a worker exists or work is run.
      this.#telemetry.workerStarted(dispatchTickId, assigned);
      this.store.prs.set(candidate.identity.number, assigned);
      this.#dispatchedWorkers.set(candidate.identity.number, assigned);
      if (dispatchTickId !== undefined) {
        this.#dispatchedTickIds.set(candidate.identity.number, dispatchTickId);
      }
      const abortController = new AbortController();
      const promise = Promise.resolve().then(() =>
        this.#workerRunner.run(
          assigned,
          abortController.signal,
          dispatchTickId,
        ),
      );
      this.store.activeWorkers.set(candidate.identity.number, promise);
      this.store.workerControllers.set(
        candidate.identity.number,
        abortController,
      );
      busyStacks.add(candidate.stackId);
      changes.push(`started ${assigned.runtimeAgent ?? "worker"}`);
      const observationPrNumber = candidate.identity.number;
      const settlement = startWorkerObservation({
        prNumber: observationPrNumber,
        promise,
        handleFailure: (error) => {
          this.#handleWorkerFailure(observationPrNumber, error);
        },
        handleResult: (result) => {
          this.#handleWorkerResult(observationPrNumber, result);
        },
        reportFatal: (error) => {
          this.#reportFatalError(error);
        },
        onSettled: () => {
          this.#workerSettlements.delete(promise);
        },
      });
      this.#workerSettlements.set(promise, settlement);
    }
  }

  #handleWorkerResult(prNumber: number, result: WorkerResult): void {
    const dispatched =
      this.#dispatchedWorkers.get(prNumber) ?? this.store.prs.get(prNumber);
    this.#dispatchedWorkers.delete(prNumber);
    const tickId = this.#dispatchedTickIds.get(prNumber);
    this.#dispatchedTickIds.delete(prNumber);
    const shouldTick = settleWorkerResult({
      store: this.store,
      telemetry: this.#telemetry,
      observer: this.#observer,
      dispatched,
      prNumber,
      result,
      tickId,
    });
    if (shouldTick && !this.store.stopping) {
      void this.#runTickSafely("worker-complete", "worker-complete tick");
    }
  }

  #handleWorkerFailure(prNumber: number, error: unknown): void {
    const recordedState = this.store.prs.get(prNumber);
    const dispatched = this.#dispatchedWorkers.get(prNumber) ?? recordedState;
    this.#dispatchedWorkers.delete(prNumber);
    const tickId = this.#dispatchedTickIds.get(prNumber);
    this.#dispatchedTickIds.delete(prNumber);
    const shouldTick = settleWorkerFailure({
      store: this.store,
      telemetry: this.#telemetry,
      observer: this.#observer,
      dispatched,
      prNumber,
      error,
      tickId,
      pause: (reason) => {
        this.pause(prNumber, reason);
      },
    });
    if (shouldTick && !this.store.stopping) {
      void this.#runTickSafely("worker-complete", "worker-complete tick");
    }
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
    await withoutCommandCorrelation(async () => {
      try {
        await this.tick(trigger);
      } catch (error) {
        if (isTelemetryCaptureError(error)) {
          this.#reportFatalError(error);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.#observer.onChange(`${label} failed: ${message}`);
        // A heartbeat clears its handle before starting the tick. If that tick
        // fails, rearm it so one transient external outage does not permanently
        // stop fleet reconciliation. Other tick triggers retain their timer.
        if (!this.store.stopping && this.#heartbeat === null) {
          this.#armHeartbeat(300);
        }
      }
    });
  }

  #reportFatalError(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (this.#fatalFailure !== undefined) {
      return;
    }
    this.#fatalFailure = failure;
    this.#tickDue = false;
    if (this.#heartbeat !== null) {
      this.#heartbeat();
      this.#heartbeat = null;
    }
    this.#onFatalError?.(failure);
  }

  prioritize(prNumber: number, priority: number): void {
    prioritizePr(this.store, prNumber, priority);
  }

  pause(prNumber: number, reason: string): void {
    pausePr(this.store, prNumber, reason);
  }

  resume(prNumber: number): void {
    resumePr(this.store, prNumber);
  }

  guide(prNumber: number, message: string): void {
    guidePr(this.store, prNumber, message);
  }

  setWorkerLimit(limit: number): void {
    updateWorkerLimit(this.store, limit);
  }

  async stop(externalSettlement: Promise<unknown>): Promise<FleetSnapshot> {
    return settleControllerShutdown({
      begin: () => {
        this.store.stopping = true;
        if (this.#heartbeat !== null) {
          this.#heartbeat();
          this.#heartbeat = null;
        }
      },
      abortActiveWorkers: () => {
        abortFleetWorkers(this.store);
      },
      activeWorkerCount: () => this.store.activeWorkers.size,
      inFlightTick: this.#tickSettled,
      workerSettlements: () => this.#workerSettlements.values(),
      externalSettlement,
      initialFailure: this.#fatalFailure,
      snapshot: () => this.snapshot(),
      telemetry: this.#telemetry,
    });
  }
}
