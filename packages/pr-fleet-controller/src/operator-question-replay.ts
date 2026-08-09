import { z } from "zod";
import type { RecordedRunEvent } from "./run-events.ts";
import {
  OperatorInputAnswerSchema,
  OperatorInputRequestSchema,
  type FleetSnapshot,
  type OperatorInputRequest,
} from "./schemas.ts";

export type OperatorQuestionReplay = {
  asked: number;
  answered: number;
  superseded: number;
  open: string[];
};

type OperatorQuestionReplayState = {
  report: OperatorQuestionReplay;
  openRequests: Map<string, OperatorInputRequest>;
};

type SnapshotPrState = FleetSnapshot["prs"][number];

function verifySnapshotRequest(
  pr: SnapshotPrState,
  request: OperatorInputRequest,
  askedRequest: OperatorInputRequest | undefined,
): void {
  if (
    askedRequest === undefined ||
    request.pr !== pr.identity.number ||
    request.headSha !== pr.identity.headSha
  ) {
    throw new Error(
      `Final snapshot operator request ${request.id} does not match its PR/head`,
    );
  }
  if (JSON.stringify(askedRequest) !== JSON.stringify(request)) {
    throw new Error(
      `Final snapshot operator request ${request.id} differs from the asked request`,
    );
  }
}

function assertCorrelation(
  event: RecordedRunEvent,
  request: OperatorInputRequest,
): void {
  if (
    event.correlation.prNumber !== request.pr ||
    event.correlation.headSha !== request.headSha ||
    event.correlation.generation !== request.generation
  ) {
    throw new Error(
      `Operator request ${request.id} does not match its PR/head correlation`,
    );
  }
}

function verifyAnswer(
  event: RecordedRunEvent,
  request: OperatorInputRequest,
): void {
  const answer = OperatorInputAnswerSchema.parse(event.payload["answer"]);
  if (answer.requestId !== request.id) {
    throw new Error(`Operator answer does not match request ${request.id}`);
  }
  if (answer.answers.length !== request.questions.length) {
    throw new Error(
      `Operator answer for ${request.id} must answer every question exactly once`,
    );
  }
  const answers = new Map(
    answer.answers.map((item) => [item.questionId, item]),
  );
  if (answers.size !== request.questions.length) {
    throw new Error(
      `Operator answer for ${request.id} must answer every question exactly once`,
    );
  }
  for (const question of request.questions) {
    const response = answers.get(question.id);
    if (response === undefined) {
      throw new Error(
        `Operator answer for ${request.id} is missing ${question.id}`,
      );
    }
    if (
      response.optionId !== null &&
      !question.options.some((option) => option.id === response.optionId)
    ) {
      throw new Error(
        `Operator answer for ${request.id} selected an unknown option`,
      );
    }
  }
}

function verifyOperatorQuestionLifecycle(
  events: RecordedRunEvent[],
): OperatorQuestionReplayState {
  const requests = new Map<
    string,
    { request: OperatorInputRequest; open: boolean }
  >();
  let answered = 0;
  let superseded = 0;
  for (const event of events) {
    if (event.kind === "operator.question.asked") {
      const request = OperatorInputRequestSchema.parse(
        event.payload["request"],
      );
      if (requests.has(request.id)) {
        throw new Error(`Operator request ID was reused: ${request.id}`);
      }
      assertCorrelation(event, request);
      requests.set(request.id, { request, open: true });
      continue;
    }
    if (
      event.kind !== "operator.question.answered" &&
      event.kind !== "operator.question.superseded"
    ) {
      continue;
    }
    const requestId = z.string().min(1).parse(event.payload["requestId"]);
    const lifecycle = requests.get(requestId);
    if (lifecycle === undefined) {
      throw new Error(`${event.kind} has no matching request: ${requestId}`);
    }
    if (!lifecycle.open) {
      throw new Error(
        `Operator request ${requestId} has multiple terminal events`,
      );
    }
    assertCorrelation(event, lifecycle.request);
    if (event.kind === "operator.question.answered") {
      verifyAnswer(event, lifecycle.request);
      answered += 1;
    } else {
      z.string().min(1).parse(event.payload["reason"]);
      superseded += 1;
    }
    lifecycle.open = false;
  }
  const openRequests = new Map<string, OperatorInputRequest>();
  for (const [id, lifecycle] of requests) {
    if (lifecycle.open) openRequests.set(id, lifecycle.request);
  }
  return {
    report: {
      asked: requests.size,
      answered,
      superseded,
      open: [...openRequests.keys()].sort(),
    },
    openRequests,
  };
}

function verifyOpenQuestionsMatchSnapshot(
  replay: OperatorQuestionReplayState,
  finalSnapshot: FleetSnapshot | null,
): void {
  const snapshotRequestIds: string[] = [];
  for (const pr of finalSnapshot?.prs ?? []) {
    const request = pr.operatorRequest;
    const waiting =
      pr.status === "waiting-for-answer" &&
      pr.classification === "waiting-for-answer";
    if (waiting !== (request !== null)) {
      throw new Error(
        `Final snapshot PR #${String(pr.identity.number)} has inconsistent operator waiting state`,
      );
    }
    if (request !== null) {
      verifySnapshotRequest(pr, request, replay.openRequests.get(request.id));
      snapshotRequestIds.push(request.id);
    }
  }
  snapshotRequestIds.sort();
  if (
    replay.report.open.length !== snapshotRequestIds.length ||
    replay.report.open.some(
      (requestId, index) => requestId !== snapshotRequestIds[index],
    )
  ) {
    throw new Error(
      "Open operator question lifecycles do not match the final fleet snapshot",
    );
  }
}

export function verifyOperatorQuestionState(
  events: RecordedRunEvent[],
  finalSnapshot: FleetSnapshot | null,
): OperatorQuestionReplay {
  const replay = verifyOperatorQuestionLifecycle(events);
  verifyOpenQuestionsMatchSnapshot(replay, finalSnapshot);
  return replay.report;
}
