import { Context } from "@temporalio/activity";
import { createTemporalClient } from "#client";
import { runAgentChatTurn } from "#lib/agent-chat-client.ts";
import {
  AgentChatTurnResultSchema,
  DispatchScheduledAgentChatTurnInputSchema,
  type AgentChatTurnResult,
  type DispatchScheduledAgentChatTurnInput,
} from "#shared/agent/agent-chat.ts";

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function dispatchScheduledAgentChatTurn(
  rawInput: DispatchScheduledAgentChatTurnInput,
): Promise<AgentChatTurnResult> {
  const input = DispatchScheduledAgentChatTurnInputSchema.parse(rawInput);
  const context = Context.current();
  const heartbeat = (): void => {
    context.heartbeat({ phase: "dispatch", chatId: input.config.chatId });
  };
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  try {
    const client = await createTemporalClient();
    return await client.withAbortSignal(context.cancellationSignal, async () =>
      AgentChatTurnResultSchema.parse(
        await runAgentChatTurn({
          client: client.workflow,
          config: input.config,
          request: input.request,
        }),
      ),
    );
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export const agentChatDispatchActivities = {
  dispatchScheduledAgentChatTurn,
};
