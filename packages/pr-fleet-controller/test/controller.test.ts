import { expect, test } from "bun:test";
import { FleetController } from "@shepherdjerred/pr-fleet-controller/src/controller.ts";
import type {
  CommandRequest,
  FleetEnvironment,
  FleetObserver,
  FleetScheduler,
  FleetTelemetry,
  WorkerRunner,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type {
  RunEventCorrelation,
  RunEventKind,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import type {
  FleetSnapshot,
  PrIdentity,
  PrState,
  ReadinessEvidence,
  WorkerResult,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { evidence, identity } from "./fixtures.ts";

class FakeEnvironment implements FleetEnvironment {
  readonly prs: PrIdentity[];
  readonly evidenceByPr: Map<number, ReadinessEvidence>;

  constructor(prs: PrIdentity[], evidenceByPr: Map<number, ReadinessEvidence>) {
    this.prs = prs;
    this.evidenceByPr = evidenceByPr;
  }

  listOpenPrs(): Promise<PrIdentity[]> {
    return Promise.resolve(this.prs);
  }

  refreshEvidence(pr: PrIdentity): Promise<ReadinessEvidence> {
    const current = this.evidenceByPr.get(pr.number);
    if (current === undefined) {
      throw new Error("Missing fake evidence");
    }
    return Promise.resolve(current);
  }

  findWorktree(): Promise<string | null> {
    return Promise.resolve("/tmp/pr-fleet-fake");
  }

  provisionWorktree(): Promise<string> {
    return Promise.resolve("/tmp/pr-fleet-fake");
  }

  assignWorktreeBranch(): Promise<void> {
    return Promise.resolve();
  }

  runLocalCommand(_request: CommandRequest) {
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }

  startRestack() {
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }

  continueRestack() {
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }

  publishFix() {
    return Promise.resolve({ headSha: "a".repeat(40) });
  }

  publishRestack() {
    return Promise.resolve({ headSha: "a".repeat(40) });
  }
}

class BlockingRunner implements WorkerRunner {
  run(_pr: PrState, signal: AbortSignal): Promise<WorkerResult> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });
  }
}

class RecordingRunner implements WorkerRunner {
  runs = 0;
  aborts = 0;
  run(_pr: PrState, signal: AbortSignal): Promise<WorkerResult> {
    this.runs += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        this.aborts += 1;
        reject(new Error("aborted"));
      });
    });
  }
}

class RecordingTelemetry implements FleetTelemetry {
  readonly runId = "controller-test";
  readonly events: {
    kind: RunEventKind;
    correlation: RunEventCorrelation;
  }[] = [];
  #nextId = 0;

  newId(prefix: string): string {
    this.#nextId += 1;
    return `${prefix}-${String(this.#nextId)}`;
  }

  traceId(): string {
    return "0".repeat(32);
  }

  record(
    kind: RunEventKind,
    _payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    this.events.push({ kind, correlation });
  }
}

class AttemptRecordingRunner implements WorkerRunner {
  readonly #telemetry: FleetTelemetry;

  constructor(telemetry: FleetTelemetry) {
    this.#telemetry = telemetry;
  }

  run(pr: PrState, signal: AbortSignal): Promise<WorkerResult> {
    this.#telemetry.record(
      "worker.attempt.started",
      { attempt: 1 },
      {
        prNumber: pr.identity.number,
        headSha: pr.identity.headSha,
        generation: pr.agentGeneration,
        modelTurnId: "worker-turn-test",
      },
    );
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });
  }
}

class MutableEnvironment implements FleetEnvironment {
  prs: PrIdentity[];
  evidenceByPr: Map<number, ReadinessEvidence>;

  constructor(prs: PrIdentity[], evidenceByPr: Map<number, ReadinessEvidence>) {
    this.prs = prs;
    this.evidenceByPr = evidenceByPr;
  }

  listOpenPrs(): Promise<PrIdentity[]> {
    return Promise.resolve(this.prs);
  }

  refreshEvidence(pr: PrIdentity): Promise<ReadinessEvidence> {
    const current = this.evidenceByPr.get(pr.number);
    if (current === undefined) {
      throw new Error("Missing fake evidence");
    }
    return Promise.resolve(current);
  }

  findWorktree(): Promise<string | null> {
    return Promise.resolve("/tmp/pr-fleet-fake");
  }

  provisionWorktree(): Promise<string> {
    return Promise.resolve("/tmp/pr-fleet-fake");
  }

  assignWorktreeBranch(): Promise<void> {
    return Promise.resolve();
  }

  runLocalCommand(_request: CommandRequest) {
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }

  startRestack() {
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }

  continueRestack() {
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }

  publishFix() {
    return Promise.resolve({ headSha: "a".repeat(40) });
  }

  publishRestack() {
    return Promise.resolve({ headSha: "a".repeat(40) });
  }
}

class ControllableRunner implements WorkerRunner {
  readonly #rejects: ((error: Error) => void)[] = [];
  run(_pr: PrState, _signal: AbortSignal): Promise<WorkerResult> {
    return new Promise((_resolve, reject) => {
      // Only settles when the test triggers it — so the abort issued during a
      // tick does not immediately settle the worker, letting the test observe
      // state between abort and settlement.
      this.#rejects.push(reject);
    });
  }
  settle(): void {
    const rejects = this.#rejects.splice(0);
    for (const reject of rejects) {
      reject(new Error("aborted"));
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

class RecordingObserver implements FleetObserver {
  readonly snapshots: FleetSnapshot[] = [];
  readonly changes: string[] = [];
  readonly masterText: string[] = [];

  onSnapshot(snapshot: FleetSnapshot): void {
    this.snapshots.push(snapshot);
  }

  onChange(change: string): void {
    this.changes.push(change);
  }

  onMasterText(text: string): void {
    this.masterText.push(text);
  }
}

class RecordingScheduler implements FleetScheduler {
  readonly callbacks = new Set<() => void>();

  schedule(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  fireNext(): void {
    for (const callback of this.callbacks) {
      this.callbacks.delete(callback);
      callback();
      return;
    }
    throw new Error("No scheduled heartbeat");
  }
}

class OneFailureEnvironment extends FakeEnvironment {
  failNextList = false;

  override listOpenPrs(): Promise<PrIdentity[]> {
    if (this.failNextList) {
      this.failNextList = false;
      return Promise.reject(new Error("transient GitHub failure"));
    }
    return super.listOpenPrs();
  }
}

test("a fleet tick classifies every PR and queues excess actionable work", async () => {
  const first = identity(1);
  const second = identity(2);
  const failedCheck = {
    name: "verify",
    state: "FAILURE",
    bucket: "fail",
    link: null,
    softFail: false,
  };
  const environment = new FakeEnvironment(
    [first, second],
    new Map([
      [1, evidence(first, { checks: [failedCheck] })],
      [2, evidence(second, { checks: [failedCheck] })],
    ]),
  );
  const observer = new RecordingObserver();
  const controller = new FleetController({
    config: {
      model: "openai/gpt-5",
      repo: "shepherdjerred/monorepo",
      checkout: "/tmp/repo",
      worktreeRoot: "/tmp/worktrees",
      maxWorkers: 1,
    },
    environment,
    workerRunner: new BlockingRunner(),
    observer,
    store: new FleetStore(1),
  });

  const report = await controller.tick("startup");
  expect(report.snapshot.open).toBe(2);
  expect(report.snapshot.active).toBe(1);
  expect(report.snapshot.queued).toBe(1);
  expect(observer.snapshots).toHaveLength(1);
  await controller.stop();
});

test("a failed heartbeat rearms reconciliation", async () => {
  const environment = new OneFailureEnvironment([], new Map());
  const observer = new RecordingObserver();
  const scheduler = new RecordingScheduler();
  const controller = new FleetController({
    config: {
      model: "openai/gpt-5",
      repo: "shepherdjerred/monorepo",
      checkout: "/tmp/repo",
      worktreeRoot: "/tmp/worktrees",
      maxWorkers: 1,
    },
    environment,
    workerRunner: new BlockingRunner(),
    observer,
    store: new FleetStore(1),
    scheduler,
  });

  await controller.start();
  expect(scheduler.callbacks.size).toBe(1);
  environment.failNextList = true;
  scheduler.fireNext();
  await flushMicrotasks();

  expect(
    observer.changes.some((change) => change.startsWith("heartbeat failed:")),
  ).toBe(true);
  expect(scheduler.callbacks.size).toBe(1);
  await controller.stop();
  expect(scheduler.callbacks.size).toBe(0);
});

test("records worker start before the runner can emit its first attempt", async () => {
  const pr = identity(1);
  const failedCheck = {
    name: "verify",
    state: "FAILURE",
    bucket: "fail",
    link: null,
    softFail: false,
  };
  const telemetry = new RecordingTelemetry();
  const controller = new FleetController({
    config: {
      model: "openai/gpt-5",
      repo: "shepherdjerred/monorepo",
      checkout: "/tmp/repo",
      worktreeRoot: "/tmp/worktrees",
      maxWorkers: 1,
    },
    environment: new FakeEnvironment(
      [pr],
      new Map([[1, evidence(pr, { checks: [failedCheck] })]]),
    ),
    workerRunner: new AttemptRecordingRunner(telemetry),
    observer: new RecordingObserver(),
    store: new FleetStore(1),
    telemetry,
  });

  await controller.tick("startup");
  await flushMicrotasks();
  const workerEvents = telemetry.events
    .map((event) => event.kind)
    .filter((kind) => kind.startsWith("worker."));
  expect(workerEvents.slice(0, 2)).toEqual([
    "worker.started",
    "worker.attempt.started",
  ]);
  await controller.stop();
});

test("aborts a worker whose assigned head changes and does not pause it", async () => {
  const failedCheck = {
    name: "verify",
    state: "FAILURE",
    bucket: "fail",
    link: null,
    softFail: false,
  };
  const before = identity(1, { headSha: "a".repeat(40) });
  const environment = new MutableEnvironment(
    [before],
    new Map([[1, evidence(before, { checks: [failedCheck] })]]),
  );
  const runner = new RecordingRunner();
  const telemetry = new RecordingTelemetry();
  const store = new FleetStore(1);
  const controller = new FleetController({
    config: {
      model: "openai/gpt-5",
      repo: "shepherdjerred/monorepo",
      checkout: "/tmp/repo",
      worktreeRoot: "/tmp/worktrees",
      maxWorkers: 1,
    },
    environment,
    workerRunner: runner,
    observer: new RecordingObserver(),
    store,
    telemetry,
  });

  await controller.tick("startup");
  expect(runner.runs).toBe(1);
  expect(store.activeWorkers.has(1)).toBe(true);

  // An external push advances the PR head while the worker is active.
  const after = identity(1, { headSha: "b".repeat(40) });
  environment.prs = [after];
  environment.evidenceByPr = new Map([
    [1, evidence(after, { checks: [failedCheck] })],
  ]);

  await controller.tick("user");
  await flushMicrotasks();

  // The stale worker was cancelled, not left running, and the PR was NOT paused
  // (it re-dispatches against the refreshed head instead).
  expect(runner.aborts).toBe(1);
  expect(store.prs.get(1)?.classification).not.toBe("paused");
  expect(store.pausedReasons.has(1)).toBe(false);
  expect(
    telemetry.events.some((event) => event.kind === "worker.cancelled"),
  ).toBe(true);
  expect(telemetry.events.some((event) => event.kind === "worker.failed")).toBe(
    false,
  );
  await controller.stop();
});

test("keeps a closed PR's leases until its worker settles", async () => {
  const failedCheck = {
    name: "verify",
    state: "FAILURE",
    bucket: "fail",
    link: null,
    softFail: false,
  };
  const pr = identity(1);
  const environment = new MutableEnvironment(
    [pr],
    new Map([[1, evidence(pr, { checks: [failedCheck] })]]),
  );
  const runner = new ControllableRunner();
  const store = new FleetStore(1);
  const controller = new FleetController({
    config: {
      model: "openai/gpt-5",
      repo: "shepherdjerred/monorepo",
      checkout: "/tmp/repo",
      worktreeRoot: "/tmp/worktrees",
      maxWorkers: 1,
    },
    environment,
    workerRunner: runner,
    observer: new RecordingObserver(),
    store,
  });

  await controller.tick("startup");
  const dispatched = store.prs.get(1);
  expect(dispatched).toBeDefined();
  if (dispatched === undefined) throw new Error("unreachable");
  // The worker holds the stack-write lease when the PR is closed out from under
  // it (mid-publish).
  expect(store.requestLease(dispatched, "stack-write")).toBe(true);

  // The PR is closed/merged externally.
  environment.prs = [];
  environment.evidenceByPr = new Map();
  await controller.tick("user");

  // Lease is NOT released while the aborted worker is still settling — a new
  // worker must not be able to grab stack-write mid-publish.
  expect(store.stackWriteOwners.get(dispatched.stackId)).toBe(1);
  expect(store.activeWorkers.has(1)).toBe(true);

  // Once the worker actually settles, its leases are released.
  runner.settle();
  await flushMicrotasks();
  expect(store.stackWriteOwners.has(dispatched.stackId)).toBe(false);
  expect(store.activeWorkers.has(1)).toBe(false);
  await controller.stop();
});
