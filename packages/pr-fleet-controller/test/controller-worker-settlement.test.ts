import { expect, test } from "bun:test";
import { ControllerTelemetry } from "@shepherdjerred/pr-fleet-controller/src/controller-telemetry.ts";
import { settleWorkerFailure } from "@shepherdjerred/pr-fleet-controller/src/controller-worker-settlement.ts";
import type {
  FleetObserver,
  FleetTelemetry,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type {
  RunEventCorrelation,
  RunEventKind,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import {
  OperatorInputRequestSchema,
  PrStateSchema,
  type FleetSnapshot,
  type WorkerResult,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { abortWorkerForOperatorInput } from "@shepherdjerred/pr-fleet-controller/src/worker-wip-tools.ts";
import { evidence, identity } from "./fixtures.ts";

class TestTelemetry implements FleetTelemetry {
  readonly runId = "worker-settlement-test";
  readonly kinds: RunEventKind[] = [];
  newId(prefix: string): string {
    return `${prefix}-1`;
  }
  traceId(): string {
    return "0".repeat(32);
  }
  record(
    kind: RunEventKind,
    _payload: Record<string, unknown>,
    _correlation: RunEventCorrelation = {},
  ): void {
    this.kinds.push(kind);
  }
}

class TestObserver implements FleetObserver {
  readonly changes: string[] = [];
  readonly snapshots: FleetSnapshot[] = [];
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

test("requesting operator input aborts only that worker and holds leases until settlement", () => {
  const pr = identity(72);
  const state = PrStateSchema.parse({
    identity: pr,
    logicalOwner: "pr-72",
    runtimeAgent: "pr-72-g1",
    agentGeneration: 1,
    model: "openai/gpt-5.6-terra",
    status: "diagnosing",
    classification: "actionable-red",
    stackId: "pr-72",
    worktree: "/tmp/worktrees/pr-72",
    setupComplete: false,
    evidence: evidence(pr),
    lastAgentReportAt: null,
    lastProgressAt: "2026-08-08T20:00:00.000Z",
    noProgressTicks: 0,
    prodSentAt: null,
    escalation: null,
    priority: 0,
  });
  const store = new FleetStore(2);
  const waitingController = new AbortController();
  const otherController = new AbortController();
  store.workerControllers.set(pr.number, waitingController);
  store.workerControllers.set(74, otherController);
  store.requestLease(state, "setup");
  store.requestLease(state, "heavy");
  store.requestLease(state, "stack-write");

  abortWorkerForOperatorInput(store, pr.number);

  expect(waitingController.signal.aborted).toBe(true);
  expect(otherController.signal.aborted).toBe(false);
  expect(store.cancelledWorkers.has(pr.number)).toBe(true);
  expect(store.setupOwner).toBe(pr.number);
  expect(store.heavyOwners.has(pr.number)).toBe(true);
  expect(store.stackWriteOwners.get(state.stackId)).toBe(pr.number);
});

test("a persisted question survives worker failure while other PRs continue", () => {
  const pr = identity(73);
  const state = PrStateSchema.parse({
    identity: pr,
    logicalOwner: "pr-73",
    runtimeAgent: "pr-73-g1",
    agentGeneration: 1,
    model: "openai/gpt-5.6-terra",
    status: "diagnosing",
    classification: "actionable-red",
    stackId: "pr-73",
    worktree: "/tmp/worktrees/pr-73",
    setupComplete: false,
    evidence: evidence(pr),
    lastAgentReportAt: null,
    lastProgressAt: "2026-08-08T20:00:00.000Z",
    noProgressTicks: 0,
    prodSentAt: null,
    escalation: null,
    priority: 0,
  });
  const request = OperatorInputRequestSchema.parse({
    id: "question-73",
    pr: pr.number,
    headSha: pr.headSha,
    generation: state.agentGeneration,
    context: "The worker found an ambiguous inherited commit.",
    questions: [
      {
        id: "ownership",
        header: "Ownership",
        question: "Should this commit ship with the PR?",
        options: [
          {
            id: "include",
            label: "Include it",
            description: "The commit paths match this PR.",
            recommended: true,
          },
          {
            id: "exclude",
            label: "Exclude it",
            description: "The commit belongs to separate work.",
            recommended: false,
          },
        ],
      },
    ],
    createdAt: "2026-08-08T20:00:00.000Z",
  });
  const store = new FleetStore(2);
  store.prs.set(pr.number, state);
  store.operatorRequests.set(pr.number, request);
  store.activeWorkers.set(
    pr.number,
    Promise.withResolvers<WorkerResult>().promise,
  );
  store.workerControllers.set(pr.number, new AbortController());
  store.activeWorkers.set(74, Promise.withResolvers<WorkerResult>().promise);
  store.requestLease(state, "setup");
  store.requestLease(state, "heavy");
  store.requestLease(state, "stack-write");
  const observer = new TestObserver();
  const fleetTelemetry = new TestTelemetry();

  abortWorkerForOperatorInput(store, pr.number);

  expect(
    settleWorkerFailure({
      store,
      telemetry: new ControllerTelemetry(fleetTelemetry),
      observer,
      dispatched: state,
      prNumber: pr.number,
      error: new Error("failed after persisting question"),
      tickId: "tick-1",
      pause: () => {
        throw new Error("question failures must not pause the PR");
      },
    }),
  ).toBe(true);

  expect(store.prs.get(pr.number)?.status).toBe("waiting-for-answer");
  expect(store.activeWorkers.has(74)).toBe(true);
  expect(store.setupOwner).toBeNull();
  expect(store.heavyOwners.has(pr.number)).toBe(false);
  expect(store.stackWriteOwners.has(state.stackId)).toBe(false);
  expect(fleetTelemetry.kinds).toContain("worker.cancelled");
  expect(observer.changes).toContain(
    "worker for PR #73 stopped after requesting operator input",
  );
});
