import {
  isAgentChatBindingConflictError,
  type AgentChatBinding,
  type AgentChatBindingUpdate,
  type AgentChatCatalogEntry,
  type AgentChatConfig,
} from "#shared/agent/agent-chat.ts";
import type { WorkflowClient } from "@temporalio/client";

export class AgentChatRegistrationConflictError extends Error {
  public constructor(chatId: string) {
    super(
      `Durable agent chat ID ${chatId} was reused with different configuration`,
    );
    this.name = "AgentChatRegistrationConflictError";
  }
}

export function sourceOrdering(input: {
  sourceSequence: string | number;
  sourceEpoch?: string | number | undefined;
}): Pick<AgentChatBindingUpdate, "sourceSequence" | "sourceEpoch"> {
  return input.sourceEpoch === undefined
    ? { sourceSequence: input.sourceSequence }
    : { sourceSequence: input.sourceSequence, sourceEpoch: input.sourceEpoch };
}

export function ingressTimestamp(
  submittedAt: string | undefined,
  now: string,
): string {
  return submittedAt ?? now;
}

export function requestedConfigMatches(
  existing: AgentChatConfig,
  requested: AgentChatConfig,
): boolean {
  return (
    existing.chatId === requested.chatId &&
    existing.title === requested.title &&
    existing.provider === requested.provider &&
    existing.model === requested.model &&
    JSON.stringify(existing.origin) === JSON.stringify(requested.origin) &&
    existing.maxTurnsPerMessage === requested.maxTurnsPerMessage
  );
}

export async function registerAndBindIdempotently(input: {
  client: WorkflowClient;
  existing: AgentChatCatalogEntry | undefined;
  config: AgentChatConfig;
  binding: AgentChatBinding;
  updateForConfig: (config: AgentChatConfig) => AgentChatBindingUpdate;
  get: (
    client: WorkflowClient,
    chatId: string,
  ) => Promise<AgentChatCatalogEntry | undefined>;
  registerAndBind: (
    client: WorkflowClient,
    config: AgentChatConfig,
    binding: AgentChatBinding,
    update: AgentChatBindingUpdate,
  ) => Promise<AgentChatCatalogEntry>;
  requestedConfigMatches: (
    existing: AgentChatConfig,
    requested: AgentChatConfig,
  ) => boolean;
}): Promise<AgentChatCatalogEntry> {
  const selectedConfig = input.existing?.config ?? input.config;
  try {
    return await input.registerAndBind(
      input.client,
      selectedConfig,
      input.binding,
      input.updateForConfig(selectedConfig),
    );
  } catch (error: unknown) {
    const raced = await input.get(input.client, input.config.chatId);
    if (raced === undefined) throw error;
    if (!input.requestedConfigMatches(raced.config, input.config)) {
      throw new AgentChatRegistrationConflictError(input.config.chatId);
    }
    return await input.registerAndBind(
      input.client,
      raced.config,
      input.binding,
      input.updateForConfig(raced.config),
    );
  }
}

export function conflictMessage(error: unknown): string | undefined {
  if (error instanceof AgentChatRegistrationConflictError) {
    return error.message;
  }
  if (isAgentChatBindingConflictError(error)) {
    return error instanceof Error ? error.message : "binding conflict";
  }
  return undefined;
}
