import { proxyActivities } from "@temporalio/workflow";
import type {
  GlitterContextAuditInput,
  GlitterContextAuditResult,
} from "#activities/glitter-context-audit-schema.ts";
import type { glitterContextAuditActivities } from "#activities/glitter-context-audit.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { auditGlitterContext } = proxyActivities<
  typeof glitterContextAuditActivities
>({
  taskQueue: TASK_QUEUES.GLITTER_CONTEXT,
  startToCloseTimeout: "1 hour",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export async function runGlitterContextAudit(
  input: GlitterContextAuditInput = {},
): Promise<GlitterContextAuditResult> {
  return await auditGlitterContext(input);
}
