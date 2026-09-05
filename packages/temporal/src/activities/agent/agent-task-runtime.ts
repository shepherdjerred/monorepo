import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import * as Sentry from "@sentry/bun";
import { agentTaskRunsTotal } from "#observability/metrics.ts";
import type { AgentTaskSecretRedactionError } from "#activities/agent/agent-task-env.ts";
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
  // This check only fires after the SDK run completed, so the agent may
  // already have applied effects; a Temporal retry would replay the entire
  // effectful run. Fail for good, like SDK and output-contract failures.
  throw ApplicationFailure.create({
    message: failure.message,
    cause: failure,
    nonRetryable: true,
    type: "AgentTaskSecretRedactionFailure",
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
  AbortSignal | undefined {
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
