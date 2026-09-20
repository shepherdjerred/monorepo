import {
  allHandlersFinished,
  condition,
  continueAsNew,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  AgentChatBindingSchema,
  AgentChatBindingUpdateSchema,
  AgentChatCatalogBindingSchema,
  AgentChatCatalogEntrySchema,
  AgentChatCatalogStateSchema,
  AgentChatIdSchema,
  MAX_AGENT_CHAT_CATALOG_BINDINGS,
  MAX_AGENT_CHAT_CATALOG_ENTRIES,
  MAX_AGENT_CHAT_CATALOG_STATE_BYTES,
  agentChatBindingKey,
  type AgentChatBinding,
  type AgentChatBindingUpdate,
  type AgentChatBindingUpdateInput,
  type AgentChatCatalogEntry,
  type AgentChatCatalogState,
} from "#shared/agent/agent-chat.ts";
import {
  bindAgentChatUpdate,
  getAgentChatCatalogEntryQuery,
  getAgentChatCatalogStateQuery,
  listAgentChatsQuery,
  recordAgentChatTurnUpdate,
  registerAndBindAgentChatUpdate,
  registerAgentChatUpdate,
  resolveAgentChatBindingQuery,
  settleAgentChatTurnUpdate,
} from "#shared/agent/agent-chat-workflow.ts";

function catalogStateBytes(state: AgentChatCatalogState): number {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
}

function timestampInstant(timestamp: string): number {
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant)) {
    throw new TypeError(`Invalid agent chat catalog timestamp: ${timestamp}`);
  }
  return instant;
}

function parseBindingUpdate(
  rawUpdate: AgentChatBindingUpdateInput,
): AgentChatBindingUpdate {
  const update = AgentChatBindingUpdateSchema.parse(
    typeof rawUpdate === "string" ? { updatedAt: rawUpdate } : rawUpdate,
  );
  if (update.orderingVersion === 1 && update.sourceSequence === undefined) {
    throw new TypeError(
      "Versioned binding updates require a monotonic source sequence",
    );
  }
  return update;
}

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

function existingBindingWins(
  existing: AgentChatCatalogState["bindings"][number],
  next: AgentChatCatalogState["bindings"][number],
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
    return sourceSequenceAtLeast(existing.sourceSequence, next.sourceSequence);
  }
  const existingInstant = Date.parse(existing.updatedAt);
  const nextInstant = Date.parse(next.updatedAt);
  if (existingInstant !== nextInstant) return existingInstant > nextInstant;
  if (
    existing.sourceSequence !== undefined &&
    next.sourceSequence === undefined
  ) {
    return true;
  }
  return false;
}
function oldestBindingIndex(
  state: AgentChatCatalogState,
  protectedBindingKey?: string,
): number {
  let selected = -1;
  for (const [index, candidate] of state.bindings.entries()) {
    if (agentChatBindingKey(candidate.binding) === protectedBindingKey)
      continue;
    const selectedBinding =
      selected === -1 ? undefined : state.bindings[selected];
    const candidateInstant = timestampInstant(candidate.updatedAt);
    const selectedInstant =
      selectedBinding === undefined
        ? undefined
        : timestampInstant(selectedBinding.updatedAt);
    if (
      selectedBinding === undefined ||
      selectedInstant === undefined ||
      candidateInstant < selectedInstant ||
      (candidateInstant === selectedInstant &&
        agentChatBindingKey(candidate.binding) <
          agentChatBindingKey(selectedBinding.binding))
    ) {
      selected = index;
    }
  }
  return selected;
}

function oldestEntryIndex(
  state: AgentChatCatalogState,
  protectedChatId?: string,
): number {
  let selected = -1;
  for (const [index, candidate] of state.entries.entries()) {
    if (candidate.config.chatId === protectedChatId) continue;
    const selectedEntry = selected === -1 ? undefined : state.entries[selected];
    const candidateInstant = timestampInstant(candidate.updatedAt);
    const selectedInstant =
      selectedEntry === undefined
        ? undefined
        : timestampInstant(selectedEntry.updatedAt);
    if (
      selectedEntry === undefined ||
      selectedInstant === undefined ||
      candidateInstant < selectedInstant ||
      (candidateInstant === selectedInstant &&
        candidate.config.chatId < selectedEntry.config.chatId)
    ) {
      selected = index;
    }
  }
  return selected;
}

export function compactAgentChatCatalogState(
  state: AgentChatCatalogState,
  protectedRecord: { chatId?: string; bindingKey?: string } = {},
): void {
  while (
    state.bindings.length > MAX_AGENT_CHAT_CATALOG_BINDINGS ||
    catalogStateBytes(state) > MAX_AGENT_CHAT_CATALOG_STATE_BYTES
  ) {
    const index = oldestBindingIndex(state, protectedRecord.bindingKey);
    if (index === -1) break;
    state.bindings.splice(index, 1);
  }

  while (
    state.entries.length > MAX_AGENT_CHAT_CATALOG_ENTRIES ||
    catalogStateBytes(state) > MAX_AGENT_CHAT_CATALOG_STATE_BYTES
  ) {
    const index = oldestEntryIndex(state, protectedRecord.chatId);
    if (index === -1) break;
    const [retired] = state.entries.splice(index, 1);
    if (retired === undefined) break;
    if (!state.retiredChatIds.includes(retired.config.chatId)) {
      state.retiredChatIds.push(retired.config.chatId);
      if (state.retiredChatIds.length > MAX_AGENT_CHAT_CATALOG_ENTRIES) {
        state.retiredChatIds.shift();
      }
    }
    state.bindings = state.bindings.filter(
      (binding) => binding.chatId !== retired.config.chatId,
    );
  }

  AgentChatCatalogStateSchema.parse(state);
}

function initialState(
  rawState: AgentChatCatalogState | undefined,
): AgentChatCatalogState {
  return rawState === undefined
    ? { schemaVersion: 1, entries: [], bindings: [], retiredChatIds: [] }
    : AgentChatCatalogStateSchema.parse(rawState);
}

function entryFor(
  state: AgentChatCatalogState,
  chatId: string,
): AgentChatCatalogEntry | undefined {
  return state.entries.find((entry) => entry.config.chatId === chatId);
}

export function registerAgentChatCatalogEntry(
  state: AgentChatCatalogState,
  rawEntry: AgentChatCatalogEntry,
): AgentChatCatalogEntry {
  const entry = AgentChatCatalogEntrySchema.parse(rawEntry);
  const existing = entryFor(state, entry.config.chatId);
  if (
    existing !== undefined &&
    existing.config.provider !== entry.config.provider
  ) {
    throw new Error(
      `Agent chat ${entry.config.chatId} is already owned by ${existing.config.provider}`,
    );
  }
  if (existing === undefined) {
    // The client validates permanent ownership against the chat Workflow.
    state.retiredChatIds = state.retiredChatIds.filter(
      (id) => id !== entry.config.chatId,
    );
    state.entries.push(entry);
    compactAgentChatCatalogState(state, { chatId: entry.config.chatId });
    return entry;
  }
  if (JSON.stringify(existing.config) !== JSON.stringify(entry.config)) {
    throw new Error(
      `Agent chat ${entry.config.chatId} is already registered with different configuration`,
    );
  }
  const refreshed = AgentChatCatalogEntrySchema.parse({
    ...existing,
    turnCount: Math.max(existing.turnCount, entry.turnCount),
    updatedAt:
      Date.parse(entry.updatedAt) > Date.parse(existing.updatedAt)
        ? entry.updatedAt
        : existing.updatedAt,
  });
  state.entries[state.entries.indexOf(existing)] = refreshed;
  compactAgentChatCatalogState(state, { chatId: entry.config.chatId });
  return refreshed;
}

function recordTurn(
  state: AgentChatCatalogState,
  rawChatId: string,
  turnCount: number,
  updatedAt: string,
): AgentChatCatalogEntry {
  const chatId = AgentChatIdSchema.parse(rawChatId);
  const existing = entryFor(state, chatId);
  if (existing === undefined) {
    throw new Error(`Cannot record a turn for unknown agent chat ${chatId}`);
  }
  const next = AgentChatCatalogEntrySchema.parse({
    ...existing,
    turnCount: Math.max(existing.turnCount, turnCount),
    updatedAt:
      Date.parse(updatedAt) > Date.parse(existing.updatedAt)
        ? updatedAt
        : existing.updatedAt,
  });
  state.entries[state.entries.indexOf(existing)] = next;
  compactAgentChatCatalogState(state, { chatId });
  return next;
}

export function settleAgentChatCatalogTurn(
  state: AgentChatCatalogState,
  rawEntry: AgentChatCatalogEntry,
  turnCount: number,
  updatedAt: string,
): AgentChatCatalogEntry {
  const entry = registerAgentChatCatalogEntry(state, rawEntry);
  return recordTurn(state, entry.config.chatId, turnCount, updatedAt);
}

function bind(
  state: AgentChatCatalogState,
  rawBinding: AgentChatBinding,
  rawChatId: string,
  rawUpdate: AgentChatBindingUpdateInput,
): AgentChatCatalogEntry {
  const binding = AgentChatBindingSchema.parse(rawBinding);
  const update = parseBindingUpdate(rawUpdate);
  const chatId = AgentChatIdSchema.parse(rawChatId);
  const entry = entryFor(state, chatId);
  if (entry === undefined) {
    throw new Error(`Cannot bind unknown agent chat ${chatId}`);
  }
  const bindingKey = agentChatBindingKey(binding);
  const existing = state.bindings.find(
    (candidate) => agentChatBindingKey(candidate.binding) === bindingKey,
  );
  const next = AgentChatCatalogBindingSchema.parse({
    binding,
    chatId,
    ...update,
  });
  if (
    existing?.tieBreaker !== undefined &&
    existing.tieBreaker === next.tieBreaker
  ) {
    if (
      existing.chatId !== next.chatId ||
      existing.updatedAt !== next.updatedAt ||
      existing.sourceSequence !== next.sourceSequence
    ) {
      throw new Error(
        `Agent chat binding operation ${next.tieBreaker} was reused with different input`,
      );
    }
    const selected = entryFor(state, existing.chatId);
    if (selected === undefined) {
      throw new Error(
        `Agent chat binding points to unknown chat ${existing.chatId}`,
      );
    }
    return selected;
  }
  if (existing !== undefined && existingBindingWins(existing, next)) {
    const selected = entryFor(state, existing.chatId);
    if (selected === undefined) {
      throw new Error(
        `Agent chat binding points to unknown chat ${existing.chatId}`,
      );
    }
    return selected;
  }
  if (existing === undefined) {
    state.bindings.push(next);
  } else {
    state.bindings[state.bindings.indexOf(existing)] = next;
  }
  compactAgentChatCatalogState(state, { chatId, bindingKey });
  return entry;
}

export function registerAndBindAgentChatCatalogEntry(
  state: AgentChatCatalogState,
  rawEntry: AgentChatCatalogEntry,
  rawBinding: AgentChatBinding,
  update: AgentChatBindingUpdateInput,
): AgentChatCatalogEntry {
  const entry = registerAgentChatCatalogEntry(state, rawEntry);
  return bind(state, rawBinding, entry.config.chatId, update);
}

function resolve(
  state: AgentChatCatalogState,
  rawBinding: AgentChatBinding,
): AgentChatCatalogEntry | undefined {
  const binding = AgentChatBindingSchema.parse(rawBinding);
  const bindingKey = agentChatBindingKey(binding);
  const selected = state.bindings.find(
    (candidate) => agentChatBindingKey(candidate.binding) === bindingKey,
  );
  return selected === undefined ? undefined : entryFor(state, selected.chatId);
}

export async function agentChatCatalogWorkflow(
  rawState?: AgentChatCatalogState,
): Promise<never> {
  const state = initialState(rawState);

  setHandler(registerAgentChatUpdate, (entry) =>
    registerAgentChatCatalogEntry(state, entry),
  );
  setHandler(recordAgentChatTurnUpdate, (chatId, turnCount, updatedAt) =>
    recordTurn(state, chatId, turnCount, updatedAt),
  );
  setHandler(settleAgentChatTurnUpdate, (entry, turnCount, updatedAt) =>
    settleAgentChatCatalogTurn(state, entry, turnCount, updatedAt),
  );
  setHandler(registerAndBindAgentChatUpdate, (entry, binding, update) =>
    registerAndBindAgentChatCatalogEntry(state, entry, binding, update),
  );
  setHandler(bindAgentChatUpdate, (binding, chatId, update) =>
    bind(state, binding, chatId, update),
  );
  setHandler(resolveAgentChatBindingQuery, (binding) =>
    resolve(state, binding),
  );
  setHandler(listAgentChatsQuery, () => [...state.entries]);
  setHandler(getAgentChatCatalogEntryQuery, (chatId) =>
    entryFor(state, AgentChatIdSchema.parse(chatId)),
  );
  setHandler(getAgentChatCatalogStateQuery, () =>
    AgentChatCatalogStateSchema.parse(state),
  );

  await condition(
    () => workflowInfo().continueAsNewSuggested && allHandlersFinished(),
  );
  return continueAsNew<typeof agentChatCatalogWorkflow>(
    AgentChatCatalogStateSchema.parse(state),
  );
}
