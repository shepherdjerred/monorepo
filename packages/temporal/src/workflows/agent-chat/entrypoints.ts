import { agentChatWorkflow as _agentChatWorkflow } from "#workflows/agent-chat.ts";
import { agentChatTurnReceiptWorkflow as _agentChatTurnReceiptWorkflow } from "#workflows/agent-chat-turn-receipt.ts";
import { agentChatCatalogWorkflow as _agentChatCatalogWorkflow } from "#workflows/agent-chat-catalog.ts";
import { scheduledAgentChatTurnWorkflow as _scheduledAgentChatTurnWorkflow } from "#workflows/scheduled-agent-chat-turn.ts";
import { discordAgentChatWorkflow as _discordAgentChatWorkflow } from "#workflows/discord-agent-chat.ts";
import { httpAgentChatWorkflow as _httpAgentChatWorkflow } from "#workflows/http-agent-chat.ts";
import type { AgentChatReceiptInput } from "#shared/agent/agent-chat-receipt.ts";
import type {
  AgentChatCatalogState,
  AgentChatTurnResult,
  AgentChatWorkflowInput,
  ScheduledAgentChatTurnInput,
} from "#shared/agent/agent-chat.ts";
import type { DiscordAgentChatCommand } from "#shared/agent/agent-chat-discord.ts";
import type {
  HttpAgentChatCommand,
  HttpAgentChatStartOptions,
} from "#shared/agent/agent-chat-http.ts";

export async function agentChatWorkflow(
  input: AgentChatWorkflowInput,
): Promise<never> {
  return _agentChatWorkflow(input);
}

export async function agentChatTurnReceiptWorkflow(
  input: AgentChatReceiptInput,
): Promise<AgentChatTurnResult> {
  return _agentChatTurnReceiptWorkflow(input);
}

export async function agentChatCatalogWorkflow(
  state?: AgentChatCatalogState,
): Promise<never> {
  return _agentChatCatalogWorkflow(state);
}

export async function scheduledAgentChatTurnWorkflow(
  input: ScheduledAgentChatTurnInput,
): Promise<AgentChatTurnResult> {
  return _scheduledAgentChatTurnWorkflow(input);
}

export async function discordAgentChatWorkflow(
  input: DiscordAgentChatCommand,
): Promise<void> {
  return _discordAgentChatWorkflow(input);
}

export async function httpAgentChatWorkflow(
  input: HttpAgentChatCommand,
  options?: HttpAgentChatStartOptions,
): Promise<AgentChatTurnResult> {
  return _httpAgentChatWorkflow(input, options);
}
