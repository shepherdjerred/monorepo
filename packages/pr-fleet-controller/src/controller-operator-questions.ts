import type { ControllerTelemetry } from "./controller-telemetry.ts";
import { withCommandCorrelation } from "./command-correlation.ts";
import type { FleetEnvironment, FleetObserver } from "./ports.ts";
import {
  OperatorInputAnswerSchema,
  type FleetTickReport,
  type OperatorInputAnswer,
  type OperatorInputRequest,
} from "./schemas.ts";
import type { FleetStore } from "./state.ts";

type OperatorQuestionDependencies = {
  store: FleetStore;
  telemetry: ControllerTelemetry;
  observer: FleetObserver;
  currentPrHead: (
    prNumber: number,
    expectedHeadSha: string,
  ) => Promise<string | null>;
  queueReconciliation: () => void;
};

export async function lookupCurrentPrHead(
  environment: FleetEnvironment,
  prNumber: number,
  expectedHeadSha: string,
): Promise<string | null> {
  const identities = await withCommandCorrelation(
    { prNumber, headSha: expectedHeadSha },
    () => environment.listOpenPrs(),
  );
  return (
    identities.find((identity) => identity.number === prNumber)?.headSha ?? null
  );
}

export function listOperatorQuestions(
  store: FleetStore,
): OperatorInputRequest[] {
  return [...store.operatorRequests.values()].sort(
    (left, right) => left.pr - right.pr,
  );
}

function answerGuidance(
  request: OperatorInputRequest,
  answer: OperatorInputAnswer,
): string {
  if (answer.answers.length !== request.questions.length) {
    throw new Error("Every operator question must be answered exactly once");
  }
  const answersByQuestion = new Map(
    answer.answers.map((item) => [item.questionId, item]),
  );
  if (answersByQuestion.size !== request.questions.length) {
    throw new Error("Every operator question must be answered exactly once");
  }
  const guidance: string[] = [];
  for (const question of request.questions) {
    const response = answersByQuestion.get(question.id);
    if (response === undefined) {
      throw new Error(`Missing answer for question ${question.id}`);
    }
    const selected =
      response.optionId === null
        ? null
        : question.options.find((option) => option.id === response.optionId);
    if (selected === undefined && response.optionId !== null) {
      throw new Error(
        `Unknown option ${response.optionId} for question ${question.id}`,
      );
    }
    const selectedLabel = selected?.label ?? null;
    guidance.push(
      [
        `Operator answer to ${question.question}`,
        selectedLabel === null ? null : `Selected: ${selectedLabel}`,
        response.freeText === null ? null : `Notes: ${response.freeText}`,
      ]
        .filter((value) => value !== null)
        .join("\n"),
    );
  }
  return guidance.join("\n\n");
}

export async function acceptOperatorAnswer(
  rawAnswer: OperatorInputAnswer,
  dependencies: OperatorQuestionDependencies,
): Promise<FleetTickReport> {
  const { store, telemetry, observer, currentPrHead, queueReconciliation } =
    dependencies;
  const answer = OperatorInputAnswerSchema.parse(rawAnswer);
  const request = [...store.operatorRequests.values()].find(
    (candidate) => candidate.id === answer.requestId,
  );
  if (request === undefined) {
    throw new Error(
      `Unknown or already-resolved operator request: ${answer.requestId}`,
    );
  }
  const remoteHead = await currentPrHead(request.pr, request.headSha);
  const currentRequest = store.operatorRequests.get(request.pr);
  const currentState = store.prs.get(request.pr);
  if (
    currentState === undefined ||
    currentState.status === "closed" ||
    currentRequest?.id !== request.id ||
    remoteHead !== request.headSha ||
    currentState.identity.headSha !== request.headSha
  ) {
    throw new Error(`Operator request ${request.id} is stale`);
  }
  const guidance = answerGuidance(request, answer);
  telemetry.operatorQuestionAnswered(request, answer);
  store.operatorRequests.delete(request.pr);
  store.addGuidance(request.pr, guidance);
  store.prs.set(request.pr, {
    ...currentState,
    operatorRequest: null,
    classification: "queued",
    status: "queued",
    escalation: null,
  });
  observer.onChange(
    `operator answered request ${request.id} for PR #${String(request.pr)}`,
  );
  queueReconciliation();
  return {
    trigger: "user",
    snapshot: store.snapshot(),
    changes: [
      `accepted operator answer for PR #${String(request.pr)} and queued reconciliation`,
    ],
    nextHeartbeatSeconds: 300,
  };
}

export async function acceptOperatorTextAnswer(
  requestId: string,
  text: string,
  dependencies: OperatorQuestionDependencies,
): Promise<FleetTickReport> {
  const request = [...dependencies.store.operatorRequests.values()].find(
    (candidate) => candidate.id === requestId,
  );
  if (request === undefined) {
    throw new Error(`Unknown operator request: ${requestId}`);
  }
  return acceptOperatorAnswer(
    {
      requestId,
      answers: request.questions.map((question) => ({
        questionId: question.id,
        optionId: null,
        freeText: text,
      })),
    },
    dependencies,
  );
}
