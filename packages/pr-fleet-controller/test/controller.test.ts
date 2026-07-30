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
