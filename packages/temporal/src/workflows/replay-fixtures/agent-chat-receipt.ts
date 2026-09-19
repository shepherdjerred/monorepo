import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineSignal,
  setHandler,
} from "@temporalio/workflow";
import { agentChatWorkflow as chat } from "#workflows/agent-chat.ts";
import { agentChatCatalogWorkflow as catalog } from "#workflows/agent-chat-catalog.ts";
import { agentChatTurnReceiptWorkflow as receipt } from "#workflows/agent-chat-turn-receipt.ts";
import {
  AgentChatWorkflowInputSchema,
  type AgentChatTurnResult,
  type AgentChatWorkflowInput,
  type AgentChatCatalogState,
} from "#shared/agent/agent-chat.ts";
import type { AgentChatReceiptInput } from "#shared/agent/agent-chat-receipt.ts";

export const rolloverChatFixtureSignal = defineSignal<[AgentChatWorkflowInput]>(
  "rolloverChatFixture",
);

export async function agentChatWorkflow(
  input: AgentChatWorkflowInput,
): Promise<never> {
  let nextInput: AgentChatWorkflowInput | undefined;
  setHandler(rolloverChatFixtureSignal, (next) => {
    nextInput = AgentChatWorkflowInputSchema.parse(next);
  });
  async function rollover(): Promise<never> {
    await condition(() => nextInput !== undefined && allHandlersFinished());
    if (nextInput === undefined) throw new Error("Missing rollover input");
    return continueAsNew<typeof agentChatWorkflow>(nextInput);
  }
  return Promise.race([chat(input), rollover()]);
}

export async function agentChatCatalogWorkflow(
  state?: AgentChatCatalogState,
): Promise<never> {
  return catalog(state);
}
export async function agentChatTurnReceiptWorkflow(
  input: AgentChatReceiptInput,
): Promise<AgentChatTurnResult> {
  return receipt(input);
}
