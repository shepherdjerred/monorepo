import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type Client,
} from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";
import {
  HttpAgentChatCommandSchema,
  HttpAgentChatTurnIdSchema,
  HttpAgentChatTurnReceiptSchema,
  HttpAgentChatTurnStatusSchema,
  httpAgentChatCommandIdentity,
  type HttpAgentChatCommand,
  type HttpAgentChatTurnReceipt,
  type HttpAgentChatTurnStatus,
} from "#shared/agent/agent-chat-http.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

function httpAgentChatWorkflowId(turnId: string): string {
  return `agent-chat-http/${turnId}`;
}

export class AgentChatTurnConflictError extends Error {
  public constructor(turnId: string) {
    super(
      `Durable agent chat turn ID ${turnId} was reused for another command`,
    );
    this.name = "AgentChatTurnConflictError";
  }
}

export function httpAgentChatCommandFingerprint(
  command: HttpAgentChatCommand,
): string {
  return new Bun.CryptoHasher("sha256")
    .update(httpAgentChatCommandIdentity(command))
    .digest("hex");
}

export async function submitHttpAgentChatCommand(
  client: Client,
  rawCommand: HttpAgentChatCommand,
): Promise<HttpAgentChatTurnReceipt> {
  const command = HttpAgentChatCommandSchema.parse(rawCommand);
  const workflowId = httpAgentChatWorkflowId(command.request.turnId);
  const fingerprint = httpAgentChatCommandFingerprint(command);
  const handle = await client.workflow
    .start("httpAgentChatWorkflow", {
      workflowId,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [command],
      memo: { agentChatCommandFingerprint: fingerprint },
    })
    .catch((error: unknown) => {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        throw error;
      }
      return client.workflow.getHandle(workflowId);
    });
  const description = await handle.describe();
  const acceptedFingerprint = description.memo?.["agentChatCommandFingerprint"];
  if (typeof acceptedFingerprint !== "string") {
    throw new TypeError(
      "Durable agent chat turn is missing its command identity",
    );
  }
  if (acceptedFingerprint !== fingerprint) {
    throw new AgentChatTurnConflictError(command.request.turnId);
  }
  return HttpAgentChatTurnReceiptSchema.parse({
    status: "accepted",
    turnId: command.request.turnId,
    workflowId,
  });
}

export async function pollHttpAgentChatCommand(
  client: Client,
  rawTurnId: string,
): Promise<HttpAgentChatTurnStatus | undefined> {
  const turnId = HttpAgentChatTurnIdSchema.parse(rawTurnId);
  const workflowId = httpAgentChatWorkflowId(turnId);
  const handle = client.workflow.getHandle(workflowId);
  try {
    const description = await handle.describe();
    if (description.status.name === "RUNNING") {
      return HttpAgentChatTurnStatusSchema.parse({
        status: "running",
        turnId,
        workflowId,
      });
    }
    if (description.status.name === "COMPLETED") {
      const result: unknown = await handle.result();
      return HttpAgentChatTurnStatusSchema.parse({
        status: "completed",
        turnId,
        workflowId,
        result,
      });
    }
    return HttpAgentChatTurnStatusSchema.parse({
      status: "failed",
      turnId,
      workflowId,
      temporalStatus: description.status.name,
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowNotFoundError) return;
    throw error;
  }
}
