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

function sourceSequenceAtLeast(
  existing: string | number,
  next: string | number,
): boolean {
  const existingDigits = String(existing);
  const nextDigits = String(next);
  return existingDigits.length === nextDigits.length
    ? existingDigits >= nextDigits
    : existingDigits.length > nextDigits.length;
}

function sourceEpochMatches(
  existing: string | number | undefined,
  next: string | number | undefined,
): boolean {
  return String(existing ?? 0) === String(next ?? 0);
}

export function existingBindingWins(
  existing: CatalogBinding,
  next: CatalogBinding,
  sourceEpochTimestampOrdering = true,
): boolean {
  if (
    existing.orderingVersion === undefined &&
    next.orderingVersion === 1 &&
    next.sourceSequence !== undefined
  ) {
    return false;
  }
  if (
    existing.sourceSequence !== undefined &&
    next.sourceSequence !== undefined
  ) {
    if (sourceEpochMatches(existing.sourceEpoch, next.sourceEpoch)) {
      return sourceSequenceAtLeast(
        existing.sourceSequence,
        next.sourceSequence,
      );
    }
    return sourceEpochTimestampOrdering
      ? Date.parse(existing.updatedAt) >= Date.parse(next.updatedAt)
      : sourceSequenceAtLeast(existing.sourceEpoch ?? 0, next.sourceEpoch ?? 0);
  }
  const existingInstant = Date.parse(existing.updatedAt);
  const nextInstant = Date.parse(next.updatedAt);
  return (
    existingInstant > nextInstant ||
    (existingInstant === nextInstant &&
      existing.sourceSequence !== undefined &&
      next.sourceSequence === undefined)
  );
}

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

export function assertDistinctSourceOrdering(
  existing: CatalogBinding | undefined,
  next: CatalogBinding,
  sourceEpochTimestampOrdering = true,
): void {
  if (
    sourceEpochTimestampOrdering &&
    existing?.sourceSequence !== undefined &&
    next.sourceSequence !== undefined &&
    !sourceEpochMatches(existing.sourceEpoch, next.sourceEpoch) &&
    Date.parse(existing.updatedAt) === Date.parse(next.updatedAt)
  ) {
    throw new AgentChatBindingConflictError(
      "Agent chat binding conflict: distinct source epochs share an update timestamp",
    );
  }
  if (
    existing?.sourceSequence !== undefined &&
    next.sourceSequence !== undefined &&
    sourceEpochMatches(existing.sourceEpoch, next.sourceEpoch) &&
    String(existing.sourceSequence) === String(next.sourceSequence) &&
    (existing.chatId !== next.chatId || existing.tieBreaker !== next.tieBreaker)
  ) {
    throw new AgentChatBindingConflictError(
      "Agent chat binding conflict: equal source ordering selected different chats",
    );
  }
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
