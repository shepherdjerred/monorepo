import { Context } from "@temporalio/activity";
import { createTemporalClient } from "#client";
import {
  locateAgentChatRun as locateRun,
  dispatchPinnedAgentChatTurn as dispatchPinned,
} from "#lib/agent-chat-receipts.ts";
import type {
  AgentChatReceiptInput,
  AgentChatPinnedTurn,
  AgentChatReceiptActivities,
} from "#shared/agent/agent-chat-receipt.ts";

export async function locateAgentChatRun(
  input: AgentChatReceiptInput,
): Promise<string> {
  const client = await createTemporalClient();
  return locateRun(client.workflow, input);
}

export async function dispatchPinnedAgentChatTurn(input: AgentChatPinnedTurn) {
  const context = Context.current();
  const heartbeat = (): void => {
    context.heartbeat({ phase: "pinned-turn", runId: input.runId });
  };
  heartbeat();
  const timer = setInterval(heartbeat, 20_000);
  try {
    const client = await createTemporalClient();
    return await dispatchPinned(client.workflow, input);
  } finally {
    clearInterval(timer);
  }
}

export const agentChatReceiptActivities: AgentChatReceiptActivities = {
  locateAgentChatRun,
  dispatchPinnedAgentChatTurn,
};
