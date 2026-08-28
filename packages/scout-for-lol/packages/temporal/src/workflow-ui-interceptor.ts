import type {
  ActivityInput,
  LocalActivityInput,
  TimerInput,
  WorkflowInterceptors,
  WorkflowInterceptorsFactory,
  WorkflowOutboundCallsInterceptor,
} from "@temporalio/workflow";
import { patched, setCurrentDetails } from "@temporalio/workflow";
import {
  TemporalUiDetailsSchema,
  TemporalUiSummarySchema,
} from "./execution-metadata.ts";

const CURRENT_DETAILS_PATCH = "temporal-ui-current-details-v1";

function humanizeTemporalType(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/[_-]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function activitySummary(activityType: string): string {
  return TemporalUiSummarySchema.parse(
    `Run ${humanizeTemporalType(activityType)} activity`,
  );
}

export function timerSummary(durationMs: number): string {
  const duration =
    durationMs >= 60_000 && durationMs % 60_000 === 0
      ? `${String(durationMs / 60_000)} minute wait`
      : durationMs >= 1000 && durationMs % 1000 === 0
        ? `${String(durationMs / 1000)} second wait`
        : `${String(durationMs)} millisecond wait`;
  return TemporalUiSummarySchema.parse(`Wait for ${duration}`);
}

export function setWorkflowPhase(details: string): void {
  if (patched(CURRENT_DETAILS_PATCH)) {
    setCurrentDetails(TemporalUiDetailsSchema.parse(details));
  }
}

export class WorkflowUiOutboundInterceptor implements WorkflowOutboundCallsInterceptor {
  async startTimer(
    input: TimerInput,
    next: (input: TimerInput) => Promise<void>,
  ): Promise<void> {
    await next({
      ...input,
      options: {
        ...input.options,
        summary: input.options?.summary ?? timerSummary(input.durationMs),
      },
    });
  }

  async scheduleActivity(
    input: ActivityInput,
    next: (input: ActivityInput) => Promise<unknown>,
  ): Promise<unknown> {
    return await next({
      ...input,
      options: {
        ...input.options,
        summary: input.options.summary ?? activitySummary(input.activityType),
      },
    });
  }

  async scheduleLocalActivity(
    input: LocalActivityInput,
    next: (input: LocalActivityInput) => Promise<unknown>,
  ): Promise<unknown> {
    return await next({
      ...input,
      options: {
        ...input.options,
        summary: input.options.summary ?? activitySummary(input.activityType),
      },
    });
  }
}

export const interceptors: WorkflowInterceptorsFactory =
  (): WorkflowInterceptors => ({
    outbound: [new WorkflowUiOutboundInterceptor()],
  });
