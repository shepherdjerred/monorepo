import { z } from "zod";
import type { RecordedRunEvent } from "./run-events.ts";
import {
  OperatorInputAnswerSchema,
  OperatorInputRequestSchema,
  type OperatorInputRequest,
} from "./schemas.ts";

export type OperatorQuestionReplay = {
  asked: number;
  answered: number;
  superseded: number;
  open: string[];
};

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

export function verifyOperatorQuestionLifecycle(
  events: RecordedRunEvent[],
): OperatorQuestionReplay {
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
  return {
    asked: requests.size,
    answered,
    superseded,
    open: [...requests]
      .filter(([, lifecycle]) => lifecycle.open)
      .map(([id]) => id)
      .sort(),
  };
}
