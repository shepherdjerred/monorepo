import {
  allHandlersFinished,
  condition,
  continueAsNew,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  AgentChatBindingSchema,
  AgentChatCatalogBindingSchema,
  AgentChatCatalogEntrySchema,
  AgentChatCatalogStateSchema,
  AgentChatIdSchema,
  MAX_AGENT_CHAT_CATALOG_BINDINGS,
  MAX_AGENT_CHAT_CATALOG_ENTRIES,
  MAX_AGENT_CHAT_CATALOG_STATE_BYTES,
  agentChatBindingKey,
  type AgentChatBinding,
  type AgentChatCatalogEntry,
  type AgentChatCatalogState,
} from "#shared/agent/agent-chat.ts";
import {
  bindAgentChatUpdate,
  getAgentChatCatalogEntryQuery,
  getAgentChatCatalogStateQuery,
  listAgentChatsQuery,
  recordAgentChatTurnUpdate,
  registerAgentChatUpdate,
  resolveAgentChatBindingQuery,
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
  return existing;
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

function bind(
  state: AgentChatCatalogState,
  rawBinding: AgentChatBinding,
  rawChatId: string,
  updatedAt: string,
): AgentChatCatalogEntry {
  const binding = AgentChatBindingSchema.parse(rawBinding);
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
    updatedAt,
  });
  if (
    existing !== undefined &&
    Date.parse(existing.updatedAt) >= Date.parse(next.updatedAt)
  ) {
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
  setHandler(bindAgentChatUpdate, (binding, chatId, updatedAt) =>
    bind(state, binding, chatId, updatedAt),
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
