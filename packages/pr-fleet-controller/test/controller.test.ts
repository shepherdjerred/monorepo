import { expect, test } from "bun:test";
import { FleetController } from "@shepherdjerred/pr-fleet-controller/src/controller.ts";
import type {
  CommandRequest,
  FleetEnvironment,
  FleetObserver,
  WorkerRunner,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
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
  await controller.stop();
});
