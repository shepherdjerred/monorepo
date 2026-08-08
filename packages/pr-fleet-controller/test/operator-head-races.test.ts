import { expect, test } from "bun:test";
import {
  deferPrAfterHeadChange,
  PrHeadChangedDuringRefreshError,
} from "@shepherdjerred/pr-fleet-controller/src/controller-evidence-refresh.ts";
import { acceptOperatorAnswer } from "@shepherdjerred/pr-fleet-controller/src/controller-operator-questions.ts";
import { ControllerTelemetry } from "@shepherdjerred/pr-fleet-controller/src/controller-telemetry.ts";
import type { FleetObserver } from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import {
  OperatorInputRequestSchema,
  PrStateSchema,
  type WorkerResult,
} from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { evidence, identity } from "./fixtures.ts";

const observer: FleetObserver = {
  onSnapshot: () => null,
  onChange: () => null,
  onMasterText: () => null,
};

function waitingState(prNumber: number) {
  const pr = identity(prNumber);
  const state = PrStateSchema.parse({
    identity: pr,
    logicalOwner: `pr-${String(prNumber)}`,
    runtimeAgent: null,
    agentGeneration: 1,
    model: "openai/gpt-5",
    status: "waiting-for-answer",
    classification: "waiting-for-answer",
    stackId: `pr-${String(prNumber)}`,
    worktree: `/tmp/worktrees/pr-${String(prNumber)}`,
    setupComplete: true,
    evidence: evidence(pr),
    lastAgentReportAt: "2026-08-08T20:00:00.000Z",
    lastProgressAt: "2026-08-08T20:00:00.000Z",
    noProgressTicks: 0,
    prodSentAt: null,
    escalation: null,
    priority: 0,
  });
  return { pr, state };
}

test("a mid-refresh head move makes stale state non-dispatchable and cancels its worker", () => {
  const { pr, state } = waitingState(74);
  const actionable = {
    ...state,
    status: "diagnosing" as const,
    classification: "actionable-red" as const,
    runtimeAgent: "pr-74-g1",
  };
  const store = new FleetStore(1);
  const controller = new AbortController();
  store.prs.set(pr.number, actionable);
  store.activeWorkers.set(
    pr.number,
    Promise.withResolvers<WorkerResult>().promise,
  );
  store.workerControllers.set(pr.number, controller);

  deferPrAfterHeadChange(
    store,
    new PrHeadChangedDuringRefreshError(pr.number, pr.headSha, "f".repeat(40)),
  );

  expect(store.prs.get(pr.number)?.classification).toBe("pending");
  expect(store.prs.get(pr.number)?.status).toBe("waiting-ci");
  expect(store.cancelledWorkers.has(pr.number)).toBe(true);
  expect(controller.signal.aborted).toBe(true);
});

test("an answer is rejected when the remote head moved before reconciliation", async () => {
  const { pr, state } = waitingState(75);
  const request = OperatorInputRequestSchema.parse({
    id: "question-75",
    pr: pr.number,
    headSha: pr.headSha,
    generation: state.agentGeneration,
    context: "The old head needs an ownership decision.",
    questions: [
      {
        id: "ownership",
        header: "Ownership",
        question: "Should the old-head change be included?",
        options: [
          {
            id: "include",
            label: "Include it",
            description: "It matches the old PR head.",
            recommended: true,
          },
          {
            id: "exclude",
            label: "Exclude it",
            description: "It belongs elsewhere.",
            recommended: false,
          },
        ],
      },
    ],
    createdAt: "2026-08-08T20:00:00.000Z",
  });
  const store = new FleetStore(1);
  store.prs.set(pr.number, { ...state, operatorRequest: request });
  store.operatorRequests.set(pr.number, request);
  let reconciliationQueued = false;

  await expect(
    acceptOperatorAnswer(
      {
        requestId: request.id,
        answers: [
          {
            questionId: "ownership",
            optionId: "include",
            freeText: null,
          },
        ],
      },
      {
        store,
        telemetry: new ControllerTelemetry(),
        observer,
        currentPrHead: () => Promise.resolve("f".repeat(40)),
        queueReconciliation: () => {
          reconciliationQueued = true;
        },
      },
    ),
  ).rejects.toThrow(/stale/);

  expect(store.operatorRequests.get(pr.number)?.id).toBe(request.id);
  expect(store.workerGuidance.has(pr.number)).toBe(false);
  expect(reconciliationQueued).toBe(false);
});
