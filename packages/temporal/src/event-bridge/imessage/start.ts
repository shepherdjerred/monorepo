import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type Client,
} from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export async function startBlueBubblesIngress(client: {
  workflow: Pick<Client["workflow"], "start">;
}): Promise<void> {
  const hasUrl = (Bun.env["BLUEBUBBLES_URL"] ?? "") !== "";
  const hasPassword = (Bun.env["BLUEBUBBLES_PASSWORD"] ?? "") !== "";
  if (!hasUrl && !hasPassword) return;
  if (!hasUrl || !hasPassword)
    throw new Error(
      "BlueBubbles ingress requires both bootstrap URL and password",
    );
  await client.workflow.start("blueBubblesIngressWorkflow", {
    workflowId: "agent-chat-bluebubbles-ingress",
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    args: [{ startedAt: new Date().toISOString(), lastRowId: 0 }],
  });
}
