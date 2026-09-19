import { defineQuery, defineUpdate } from "@temporalio/workflow";
import type {
  AgentChatBinding,
  AgentChatCatalogEntry,
  AgentChatCatalogState,
  AgentChatTurnRequest,
  AgentChatTurnResult,
  AgentChatWorkflowState,
} from "./agent-chat.ts";

export const runAgentChatTurnUpdate = defineUpdate<
  AgentChatTurnResult,
  [AgentChatTurnRequest]
>("runAgentChatTurn");

export const getAgentChatStateQuery =
  defineQuery<AgentChatWorkflowState>("getAgentChatState");

export const registerAgentChatUpdate = defineUpdate<
  AgentChatCatalogEntry,
  [AgentChatCatalogEntry]
>("registerAgentChat");

export const bindAgentChatUpdate = defineUpdate<
  AgentChatCatalogEntry,
  [AgentChatBinding, string, string]
>("bindAgentChat");

export const registerAndBindAgentChatUpdate = defineUpdate<
  AgentChatCatalogEntry,
  [AgentChatCatalogEntry, AgentChatBinding, string]
>("registerAndBindAgentChat");

export const recordAgentChatTurnUpdate = defineUpdate<
  AgentChatCatalogEntry,
  [string, number, string]
>("recordAgentChatTurn");

export const settleAgentChatTurnUpdate = defineUpdate<
  AgentChatCatalogEntry,
  [AgentChatCatalogEntry, number, string]
>("settleAgentChatTurn");

export const resolveAgentChatBindingQuery = defineQuery<
  AgentChatCatalogEntry | undefined,
  [AgentChatBinding]
>("resolveAgentChatBinding");

export const listAgentChatsQuery =
  defineQuery<AgentChatCatalogEntry[]>("listAgentChats");

export const getAgentChatCatalogEntryQuery = defineQuery<
  AgentChatCatalogEntry | undefined,
  [string]
>("getAgentChatCatalogEntry");

export const getAgentChatCatalogStateQuery = defineQuery<AgentChatCatalogState>(
  "getAgentChatCatalogState",
);
