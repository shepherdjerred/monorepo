import {
  AgentChatBindingConflictError,
  AgentChatCatalogBindingOperationSchema,
  MAX_AGENT_CHAT_CATALOG_BINDINGS,
  agentChatBindingKey,
  type AgentChatCatalogEntry,
  type AgentChatCatalogState,
} from "#shared/agent/agent-chat.ts";

type CatalogBinding = AgentChatCatalogState["bindings"][number];
type StoredBindingOperation = NonNullable<
  AgentChatCatalogState["bindingOperations"]
>[number];

export function sameBindingOperation(
  existing: CatalogBinding | StoredBindingOperation,
  next: CatalogBinding,
): boolean {
  return (
    (("requestedChatId" in existing ? existing.requestedChatId : undefined) ??
      existing.chatId) === next.chatId &&
    existing.updatedAt === next.updatedAt &&
    existing.sourceSequence === next.sourceSequence &&
    existing.sourceEpoch === next.sourceEpoch
  );
}

export function retainedOperationEntry(
  state: AgentChatCatalogState,
  bindingKey: string,
  next: CatalogBinding,
): AgentChatCatalogEntry | undefined {
  if (next.tieBreaker === undefined) return undefined;
  const operation = state.bindingOperations?.find(
    (candidate) =>
      candidate.tieBreaker === next.tieBreaker &&
      agentChatBindingKey(candidate.binding) === bindingKey,
  );
  if (operation === undefined) return undefined;
  if (!sameBindingOperation(operation, next)) {
    throw new AgentChatBindingConflictError(
      `Agent chat binding conflict: operation ${next.tieBreaker} was reused with different input`,
    );
  }
  const selected = state.entries.find(
    (entry) => entry.config.chatId === operation.chatId,
  );
  if (selected === undefined) {
    throw new AgentChatBindingConflictError(
      `Agent chat binding conflict: operation ${next.tieBreaker} refers to a retired chat`,
    );
  }
  return selected;
}

export function retainBindingOperation(
  state: AgentChatCatalogState,
  next: CatalogBinding,
  resultChatId = next.chatId,
): void {
  if (next.tieBreaker === undefined) return;
  const operations = state.bindingOperations?.slice() ?? [];
  if (operations.length >= MAX_AGENT_CHAT_CATALOG_BINDINGS) operations.shift();
  state.bindingOperations = [
    ...operations,
    AgentChatCatalogBindingOperationSchema.parse({
      ...next,
      chatId: resultChatId,
      requestedChatId: next.chatId,
    }),
  ];
}
