import {
  AgentChatBindingConflictError,
  type AgentChatCatalogState,
} from "#shared/agent/agent-chat.ts";

type CatalogBinding = AgentChatCatalogState["bindings"][number];

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
