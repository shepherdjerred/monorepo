import {
  condition,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  AgentChatTurnResultSchema,
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_INGRESS_MAX_ATTEMPTS,
  AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  HttpAgentChatCommandSchema,
  HttpAgentChatStartOptionsSchema,
  activateHttpAgentChatCommandUpdate,
  httpAgentChatCommandIdentity,
  type HttpAgentChatActivities,
  type HttpAgentChatCommand,
  type HttpAgentChatStartOptions,
} from "#shared/agent/agent-chat-http.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const activities = proxyActivities<HttpAgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  scheduleToCloseTimeout: AGENT_CHAT_INGRESS_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_INGRESS_MAX_ATTEMPTS },
});

const DEFAULT_START_OPTIONS = { waitForActivation: false } as const;

export async function httpAgentChatWorkflow(
  rawCommand: HttpAgentChatCommand,
  rawOptions: HttpAgentChatStartOptions = DEFAULT_START_OPTIONS,
): Promise<AgentChatTurnResult> {
  let command = HttpAgentChatCommandSchema.parse(rawCommand);
  const claimedIdentity = httpAgentChatCommandIdentity(command);
  const options = HttpAgentChatStartOptionsSchema.parse(rawOptions);
  let activated = !options.waitForActivation;
  setHandler(
    activateHttpAgentChatCommandUpdate,
    (rawActivationCommand) => {
      command = HttpAgentChatCommandSchema.parse(rawActivationCommand);
      activated = true;
      return null;
    },
    {
      validator: (rawActivationCommand) => {
        const activationCommand =
          HttpAgentChatCommandSchema.parse(rawActivationCommand);
        if (
          httpAgentChatCommandIdentity(activationCommand) !== claimedIdentity
        ) {
          throw new Error(
            "Activated agent chat command does not match its claim",
          );
        }
      },
    },
  );
  await condition(() => activated);
  const providerStartDeadline = new Date(
    workflowInfo().startTime.getTime() +
      AGENT_CHAT_INGRESS_ADMISSION_TIMEOUT_MS,
  ).toISOString();
  return AgentChatTurnResultSchema.parse(
    await activities.executeHttpAgentChatCommand({
      command,
      providerStartDeadline,
    }),
  );
}
