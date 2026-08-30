import * as Sentry from "@sentry/bun";
import { Context } from "@temporalio/activity";
import { emitOtel } from "#observability/log.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { workflowExecutionContext } from "./temporal-context.ts";

type LogLevel = "info" | "warning" | "error";

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
    // Local scripts can call activities directly without a Temporal context.
    return undefined;
  }
}

export function createActivityObservability(
  component: string,
  sentryContextName: string,
): {
  jsonLog: (
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ) => void;
  captureWithContext: (error: unknown, extra?: Record<string, unknown>) => void;
  safeHeartbeat: (payload: Record<string, unknown>) => void;
} {
  return {
    jsonLog(level, message, fields = {}): void {
      const info = activityInfoOrUndefined();
      const base: Record<string, unknown> = {
        level,
        msg: message,
        component,
        ...getTraceContext(),
        ...fields,
      };
      if (info !== undefined) {
        Object.assign(base, info);
      }
      console.warn(JSON.stringify(base));
      emitOtel(level, message, { module: component, ...info, ...fields });
    },
    captureWithContext(error, extra = {}): void {
      Sentry.withScope((scope) => {
        scope.setTag("component", component);
        const info = activityInfoOrUndefined();
        if (info !== undefined) {
          scope.setTag("workflow", String(info["workflow"]));
          scope.setTag("activity", String(info["activity"]));
        }
        scope.setContext(sentryContextName, { ...info, ...extra });
        Sentry.captureException(error);
      });
    },
    safeHeartbeat(payload): void {
      try {
        Context.current().heartbeat(payload);
      } catch {
        // Local scripts can call activities directly; heartbeats are a no-op.
      }
    },
  };
}
