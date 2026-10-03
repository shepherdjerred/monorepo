import {
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowClient,
} from "@temporalio/client";
import {
  admitPhotonMessageUpdate,
  PhotonConversationStateSchema,
  PhotonMessageSchema,
  photonConversationWorkflowId,
  type PhotonConversationState,
  type PhotonMessage,
} from "#shared/agent/agent-chat-photon.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type ConversationWorkflow = (state: PhotonConversationState) => Promise<never>;
export async function admitPhotonMessage(
  client: WorkflowClient,
  rawMessage: PhotonMessage,
) {
  const message = PhotonMessageSchema.parse(rawMessage);
  return await client.executeUpdateWithStart(admitPhotonMessageUpdate, {
    // Include content so Temporal's update-result cache cannot hide an ID conflict.
    updateId: `${message.messageId}/${message.fingerprint}`,
    args: [message],
    startWorkflowOperation:
      new WithStartWorkflowOperation<ConversationWorkflow>(
        "photonConversationWorkflow",
        {
          workflowId: photonConversationWorkflowId(message.conversationId),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          args: [
            PhotonConversationStateSchema.parse({
              conversationId: message.conversationId,
            }),
          ],
        },
      ),
  });
}
