import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { agentTaskRunsTotal } from "#observability/metrics.ts";
import type { AgentTaskSecretRedactionError } from "#activities/agent-task-env.ts";
import type { AgentTaskLlmTrace } from "#activities/agent-task-llm-trace.ts";
import type { TrackedAgentResult } from "#shared/agent-subprocess.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";

const COMPONENT = "agent-task";
const DEFAULT_WORKFLOW_TYPE = "agentTaskWorkflow";

export function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const info = activityInfoOrUndefined();
  const base: Record<string, unknown> = {
    level,
    msg: message,
    component: COMPONENT,
    ...getTraceContext(),
    ...fields,
  };
  if (info !== undefined) {
    Object.assign(base, info);
  }
  console.warn(JSON.stringify(base));
}

function activityInfoOrUndefined(): Record<string, unknown> | undefined {
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      ...workflowExecutionContext(info),
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    return undefined;
  }
}

export function captureWithContext(
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    const info = activityInfoOrUndefined();
    if (info !== undefined) {
      scope.setTag("workflow", String(info["workflow"]));
      scope.setTag("activity", String(info["activity"]));
    }
    scope.setContext("agentTask", { ...info, ...extra });
    Sentry.captureException(error);
  });
}

export function throwIfAgentTaskSecretRedactionFailed(
  failure: AgentTaskSecretRedactionError | undefined,
  context: { provider: string; durationMs: number; signal: string },
): void {
  if (failure === undefined) {
    return;
  }
  agentTaskRunsTotal.inc({
    provider: context.provider,
    outcome: "redaction_failed",
  });
  captureWithContext(failure, {
    provider: context.provider,
    durationMs: context.durationMs,
    phase: "secret-redaction",
    signal: context.signal,
  });
  throw failure;
}

export function enforceAgentTaskSecretRedactionHealth(input: {
  llmTrace: Pick<AgentTaskLlmTrace, "recordMetadataOnly">;
  failure: AgentTaskSecretRedactionError | undefined;
  result: Pick<TrackedAgentResult, "exitCode" | "durationMs" | "signal">;
  provider: string;
  startTimeMs: number;
}): void {
  if (input.failure !== undefined) {
    input.llmTrace.recordMetadataOnly({
      exitCode: input.result.exitCode,
      startTimeMs: input.startTimeMs,
      durationMs: input.result.durationMs,
    });
  }
  throwIfAgentTaskSecretRedactionFailed(input.failure, {
    provider: input.provider,
    durationMs: input.result.durationMs,
    signal: input.result.signal,
  });
}

export function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Local scripts can call activities directly; outside Temporal this is a no-op.
  }
}

export function activityCancellationSignalOrUndefined():
  | AbortSignal
  | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

export function currentWorkflowType(): string {
  try {
    return Context.current().info.workflowType ?? DEFAULT_WORKFLOW_TYPE;
  } catch {
    return DEFAULT_WORKFLOW_TYPE;
  }
}

export function startToCloseTimeoutMsOrUndefined(): number | undefined {
  try {
    return Context.current().info.startToCloseTimeoutMs;
  } catch {
    return undefined;
  }
}

export function workflowId(): string {
  try {
    return (
      Context.current().info.workflowExecution?.workflowId ??
      `agent-task-local-${crypto.randomUUID()}`
    );
  } catch {
    return `agent-task-local-${crypto.randomUUID()}`;
  }
}
