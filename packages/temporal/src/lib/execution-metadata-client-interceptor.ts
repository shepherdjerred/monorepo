import type {
  WorkflowClientInterceptor,
  WorkflowSignalWithStartInput,
  WorkflowStartInput,
  WorkflowStartOutput,
} from "@temporalio/client";
import type { Next } from "@temporalio/common";
import {
  buildExecutionStartMetadata,
  type TemporalBootstrapMetadata,
} from "#shared/execution-metadata.ts";
import { TaskQueueSchema } from "#shared/task-queues.ts";
import type { ExecutionTrigger } from "@scout-for-lol/temporal/execution-metadata";

function triggerForWorkflowType(workflowType: string): ExecutionTrigger {
  switch (workflowType) {
    case "agentTaskWorkflow":
      return "api";
    case "deliverReportWorkflow":
      return "workflow";
    default:
      return "webhook";
  }
}

function enrichOptions(
  workflowType: string,
  options: WorkflowStartInput["options"],
  bootstrap: TemporalBootstrapMetadata,
) {
  const taskQueue = TaskQueueSchema.parse(options.taskQueue);
  return {
    ...options,
    ...buildExecutionStartMetadata({
      bootstrap,
      workflowType,
      taskQueue,
      trigger: triggerForWorkflowType(workflowType),
      summary: `Run ${workflowType}`,
      description: `Starts the ${workflowType} durable workflow.`,
    }),
  };
}

export class ExecutionMetadataClientInterceptor implements WorkflowClientInterceptor {
  readonly #bootstrap: TemporalBootstrapMetadata;

  constructor(bootstrap: TemporalBootstrapMetadata) {
    this.#bootstrap = bootstrap;
  }

  async startWithDetails(
    input: WorkflowStartInput,
    next: Next<WorkflowClientInterceptor, "startWithDetails">,
  ): Promise<WorkflowStartOutput> {
    return await next({
      ...input,
      options: enrichOptions(
        input.workflowType,
        input.options,
        this.#bootstrap,
      ),
    });
  }

  async signalWithStart(
    input: WorkflowSignalWithStartInput,
    next: Next<WorkflowClientInterceptor, "signalWithStart">,
  ): Promise<string> {
    return await next({
      ...input,
      options: enrichOptions(
        input.workflowType,
        input.options,
        this.#bootstrap,
      ),
    });
  }
}
