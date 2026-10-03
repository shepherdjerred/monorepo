import {
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_MAX_ATTEMPTS,
  AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  AgentChatTurnResultSchema,
} from "#shared/agent/agent-chat.ts";
import { PreparedImessageCommandSchema } from "#shared/agent/agent-chat-imessage.ts";
import type { HttpAgentChatActivities } from "#shared/agent/agent-chat-http.ts";
import {
  photonCommandInputQuery,
  PhotonCommandSchema,
  type PhotonCommand,
  type PhotonActivities,
} from "#shared/agent/agent-chat-photon.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const preparation = proxyActivities<
  Pick<PhotonActivities, "preparePhotonCommand">
>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_PHOTON,
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});
const execution = proxyActivities<HttpAgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  scheduleToCloseTimeout: AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_INGRESS_MAX_ATTEMPTS },
});
const delivery = proxyActivities<
  Pick<PhotonActivities, "deliverPhotonResponse">
>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_PHOTON,
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});

export async function photonAgentChatWorkflow(
  rawCommand: PhotonCommand,
): Promise<void> {
  const command = PhotonCommandSchema.parse(rawCommand);
  setHandler(photonCommandInputQuery, () => command);
  const prepared = PreparedImessageCommandSchema.parse(
    await preparation.preparePhotonCommand(command),
  );
  let content: string;
  if (prepared.kind === "message") content = prepared.content;
  else {
    try {
      const providerStartDeadline = new Date(
        workflowInfo().startTime.getTime() +
          AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
      ).toISOString();
      const result = AgentChatTurnResultSchema.parse(
        await execution.executeHttpAgentChatCommand({
          command: prepared.command,
          providerStartDeadline,
        }),
      );
      content = result.finalText;
    } catch {
      content =
        "The durable agent chat request failed. Check its Temporal execution; it will not automatically repeat provider effects.";
    }
  }
  await delivery.deliverPhotonResponse({
    messageId: command.messageId,
    spaceId: command.spaceId,
    senderId: command.senderId,
    linePhone: command.linePhone,
    content,
  });
}
