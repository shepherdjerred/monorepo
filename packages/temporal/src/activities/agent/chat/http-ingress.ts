import { Context } from "@temporalio/activity";
import { createTemporalClient } from "#client";
import { continueAgentChat, runAgentChatTurn } from "#lib/agent-chat-client.ts";
import {
  AgentChatTurnResultSchema,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  HttpAgentChatCommandSchema,
  type HttpAgentChatCommand,
} from "#shared/agent/agent-chat-http.ts";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function executeHttpAgentChatCommand(
  rawCommand: HttpAgentChatCommand,
): Promise<AgentChatTurnResult> {
  const command = HttpAgentChatCommandSchema.parse(rawCommand);
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
            request: command.request,
            bindSource: true,
          })
        : await continueAgentChat({
            client: client.workflow,
            request: command.request,
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
