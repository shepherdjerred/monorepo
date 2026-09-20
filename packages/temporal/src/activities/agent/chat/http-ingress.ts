import { Context } from "@temporalio/activity";
import { createTemporalClient } from "#client";
import { continueAgentChat, runAgentChatTurn } from "#lib/agent-chat-client.ts";
import {
  AgentChatTurnResultSchema,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  HttpAgentChatActivityInputSchema,
  type HttpAgentChatActivityInput,
} from "#shared/agent/agent-chat-http.ts";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function executeHttpAgentChatCommand(
  rawInput: HttpAgentChatActivityInput,
): Promise<AgentChatTurnResult> {
  const input = HttpAgentChatActivityInputSchema.parse(rawInput);
  const command = input.command;
  const requestedDeadline = command.request.providerStartDeadline;
  const providerStartDeadline =
    requestedDeadline === undefined
      ? input.providerStartDeadline
      : new Date(
          Math.min(
            Date.parse(requestedDeadline),
            Date.parse(input.providerStartDeadline),
          ),
        ).toISOString();
  const request = { ...command.request, providerStartDeadline };
  const context = Context.current();
  const heartbeat = (): void => {
    context.heartbeat({
      phase: "agent-chat",
      turnId: command.request.turnId,
    });
  };
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  try {
    const client = await createTemporalClient();
    const result =
      command.kind === "new"
        ? await runAgentChatTurn({
            client: client.workflow,
            config: command.config,
            request,
            bindSource: true,
          })
        : await continueAgentChat({
            client: client.workflow,
            request,
            chatId: command.chatId,
          });
    return AgentChatTurnResultSchema.parse(result);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export const httpAgentChatActivities = {
  executeHttpAgentChatCommand,
};
