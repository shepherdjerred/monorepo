import { Counter, Histogram, Gauge, Registry } from "prom-client";
import { z } from "zod";

/**
 * Prometheus metrics registry
 */
export const registry = new Registry();

/**
 * Counter for workflow executions
 */
export const workflowExecutionsTotal = new Counter<"workflow" | "status">({
  name: "ha_workflow_executions_total",
  help: "Total number of workflow executions",
  labelNames: ["workflow", "status"] as const,
  registers: [registry],
});

/**
 * Histogram for workflow duration
 */
export const workflowDurationSeconds = new Histogram<"workflow">({
  name: "ha_workflow_duration_seconds",
  help: "Duration of workflow execution in seconds",
  labelNames: ["workflow"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

/**
 * Gauge for workflows currently in progress
 */
export const workflowsInProgress = new Gauge<"workflow">({
  name: "ha_workflows_in_progress",
  help: "Number of workflows currently executing",
  labelNames: ["workflow"] as const,
  registers: [registry],
});

/**
 * Counter for workflow errors
 */
export const workflowErrorsTotal = new Counter<"workflow" | "error_type">({
  name: "ha_workflow_errors_total",
  help: "Total number of workflow errors",
  labelNames: ["workflow", "error_type"] as const,
  registers: [registry],
});

/**
 * Gauge for application uptime
 */
export const uptimeSeconds = new Gauge({
  name: "ha_uptime_seconds",
  help: "Application uptime in seconds",
  registers: [registry],
});

/**
 * Gauge for last workflow execution timestamp
 */
export const workflowLastExecutionTimestamp = new Gauge<"workflow" | "status">({
  name: "ha_workflow_last_execution_timestamp",
  help: "Unix timestamp of the last workflow execution",
  labelNames: ["workflow", "status"] as const,
  registers: [registry],
});

// Track uptime
const startTime = Date.now();
setInterval(() => {
  uptimeSeconds.set((Date.now() - startTime) / 1000);
}, 1000);

let isConnected: (() => boolean) | undefined;

export function setConnectionChecker(checker: () => boolean) {
  isConnected = checker;
}

/**
 * Wrapper function to instrument any async function with Prometheus metrics
 */
export async function instrumentWorkflow<T>(workflowName: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (isConnected && !isConnected()) {
    workflowExecutionsTotal.inc({ workflow: workflowName, status: "skipped" });
    return undefined;
  }

  const end = workflowDurationSeconds.startTimer({ workflow: workflowName });
  workflowsInProgress.inc({ workflow: workflowName });

  try {
    const result = await fn();
    workflowExecutionsTotal.inc({ workflow: workflowName, status: "success" });
    workflowLastExecutionTimestamp.set({ workflow: workflowName, status: "success" }, Date.now() / 1000);
    return result;
  } catch (error: unknown) {
    workflowExecutionsTotal.inc({ workflow: workflowName, status: "failure" });
    workflowLastExecutionTimestamp.set({ workflow: workflowName, status: "failure" }, Date.now() / 1000);

    const errorType = z
      .instanceof(Error)
      .transform((error) => error.constructor.name)
      .catch(() => "Unknown")
      .parse(error);
    workflowErrorsTotal.inc({ workflow: workflowName, error_type: errorType });

    throw error;
  } finally {
    end();
    workflowsInProgress.dec({ workflow: workflowName });
  }
}
