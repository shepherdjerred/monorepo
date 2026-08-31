import { trace } from "@opentelemetry/api";
import { workflowInfo } from "@temporalio/workflow";
import type {
  Next,
  WorkflowExecuteInput,
  WorkflowInboundCallsInterceptor,
  WorkflowInterceptors,
  WorkflowInterceptorsFactory,
} from "@temporalio/workflow";
import { executionDomainForWorkflow } from "#shared/execution-metadata.ts";
import { TaskQueueSchema } from "#shared/task-queues.ts";

/**
 * The central Workflow-only process (worker.ts's "workflows" role) is shared
 * across every domain — it polls TASK_QUEUES.WORKFLOWS plus every legacy
 * per-domain queue it drains — so the OpenTelemetry Resource attribute set
 * once at worker boot (installRuntime/initializeTracing) can only ever read
 * "platform" for it: Resource attributes are process-wide and cannot vary
 * per execution. Tag the RunWorkflow span itself with the real per-execution
 * domain instead, so the temporal-platform-health dashboard's unscoped
 * `.temporal.domain =~ "$domain"` TraceQL filter can still find the
 * home/reports/etc. traces this shared process actually hosts.
 *
 * Registered in worker.ts's workflowModules list AFTER the official
 * @temporalio/interceptors-opentelemetry module, so trace.getActiveSpan()
 * here is the RunWorkflow span that interceptor already opened (interceptor
 * composition runs modules' inbound interceptors in list order, each
 * wrapping the next — see @temporalio/common's composeInterceptorsWith).
 */
export class WorkflowDomainTaggingInterceptor implements WorkflowInboundCallsInterceptor {
  async execute(
    input: WorkflowExecuteInput,
    next: Next<WorkflowInboundCallsInterceptor, "execute">,
  ): Promise<unknown> {
    const info = workflowInfo();
    const taskQueue = TaskQueueSchema.parse(info.taskQueue);
    const domain = executionDomainForWorkflow(info.workflowType, taskQueue);
    trace.getActiveSpan()?.setAttribute("temporal.domain", domain);
    return await next(input);
  }
}

export const interceptors: WorkflowInterceptorsFactory =
  (): WorkflowInterceptors => ({
    inbound: [new WorkflowDomainTaggingInterceptor()],
  });
