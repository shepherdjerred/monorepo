import {
  WithStartWorkflowOperation,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  type WorkflowClient,
} from "@temporalio/client";
import { createHash } from "node:crypto";
import {
  AGENT_CHAT_CATALOG_WORKFLOW_ID,
  AGENT_CHAT_RECEIPT_WORKFLOW_TIMEOUT_MS,
  AgentChatBindingSchema,
  AgentChatCatalogEntrySchema,
  AgentChatConfigSchema,
  agentChatTurnRequestsMatch,
  AgentChatTurnRequestSchema,
  AgentChatTurnResultSchema,
  AgentChatWorkflowStateSchema,
  agentChatWorkflowId,
  type AgentChatBinding,
  type AgentChatCatalogEntry,
  type AgentChatCatalogState,
  type AgentChatConfig,
  type AgentChatTurnRequest,
  type AgentChatTurnResult,
  type AgentChatWorkflowInput,
} from "#shared/agent/agent-chat.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { agentChatReceiptWorkflowId } from "./agent-chat-receipts.ts";
import {
  AgentChatReceiptInputSchema,
  awaitAgentChatReceiptUpdate,
  getAgentChatReceiptInputQuery,
  type AgentChatReceiptInput,
} from "#shared/agent/agent-chat-receipt.ts";
import {
  bindAgentChatUpdate,
  getAgentChatCatalogEntryQuery,
  getAgentChatStateQuery,
  listAgentChatsQuery,
  registerAgentChatUpdate,
  resolveAgentChatBindingQuery,
  settleAgentChatTurnUpdate,
} from "#shared/agent/agent-chat-workflow.ts";

export class AgentChatNotFoundError extends Error {
  public constructor(chatId: string) {
    super(`Unknown durable agent chat: ${chatId}`);
    this.name = "AgentChatNotFoundError";
  }
}

export class AgentChatBindingNotFoundError extends Error {
  public constructor() {
    super("No active durable agent chat is bound to this ingress conversation");
    this.name = "AgentChatBindingNotFoundError";
  }
}

type AgentChatCatalogWorkflow = (
  state?: AgentChatCatalogState,
) => Promise<never>;
type AgentChatWorkflow = (input: AgentChatWorkflowInput) => Promise<never>;
type AgentChatReceiptWorkflow = (
  input: AgentChatReceiptInput,
) => Promise<AgentChatTurnResult>;

function catalogStart(): WithStartWorkflowOperation<AgentChatCatalogWorkflow> {
  return new WithStartWorkflowOperation<AgentChatCatalogWorkflow>(
    "agentChatCatalogWorkflow",
    {
      workflowId: AGENT_CHAT_CATALOG_WORKFLOW_ID,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [],
    },
  );
}

function catalogEntryFromWorkflowState(
  state: ReturnType<typeof AgentChatWorkflowStateSchema.parse>,
): AgentChatCatalogEntry {
  const last = state.recentTurns.at(-1);
  return AgentChatCatalogEntrySchema.parse({
    schemaVersion: 1,
    config: state.config,
    turnCount: state.nextTurnNumber - 1,
    updatedAt:
      last === undefined
        ? state.config.createdAt
        : last.status === "completed"
          ? last.result.completedAt
          : last.failedAt,
  });
}

export async function registerAgentChat(
  client: WorkflowClient,
  rawConfig: AgentChatConfig,
): Promise<AgentChatCatalogEntry> {
  const config = AgentChatConfigSchema.parse(rawConfig);
  const chat = await client.start<AgentChatWorkflow>("agentChatWorkflow", {
    workflowId: agentChatWorkflowId(config.chatId),
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    args: [{ config }],
  });
  const state = AgentChatWorkflowStateSchema.parse(
    await chat.query(getAgentChatStateQuery),
  );
  if (JSON.stringify(state.config) !== JSON.stringify(config)) {
    throw new Error(
      `Agent chat ${config.chatId} is already owned by different immutable configuration`,
    );
  }
  const entry = catalogEntryFromWorkflowState(state);
  return await client.executeUpdateWithStart(registerAgentChatUpdate, {
    args: [entry],
    startWorkflowOperation: catalogStart(),
  });
}

export async function bindAgentChat(
  client: WorkflowClient,
  rawBinding: AgentChatBinding,
  chatId: string,
  options: {
    updatedAt: string;
    purpose?: "initial" | "restore";
  },
): Promise<AgentChatCatalogEntry> {
  const binding = AgentChatBindingSchema.parse(rawBinding);
  const purpose = options.purpose ?? "initial";
  // Restoring an evicted binding must reach the catalog even if a previous
  // restore used the same input and was subsequently compacted away.
  const restorationAttempt =
    purpose === "restore" ? crypto.randomUUID() : undefined;
  if ((await getAgentChat(client, chatId)) === undefined) {
    throw new AgentChatNotFoundError(chatId);
  }
  const updateId = createHash("sha256")
    .update(
      JSON.stringify({
        binding,
        chatId,
        updatedAt: options.updatedAt,
        purpose,
        restorationAttempt,
      }),
    )
    .digest("hex");
  return await client.executeUpdateWithStart(bindAgentChatUpdate, {
    args: [binding, chatId, options.updatedAt],
    updateId: `agent-chat-binding/${updateId}`,
    startWorkflowOperation: catalogStart(),
  });
}

export async function resolveAgentChatBinding(
  client: WorkflowClient,
  rawBinding: AgentChatBinding,
): Promise<AgentChatCatalogEntry | undefined> {
  const binding = AgentChatBindingSchema.parse(rawBinding);
  const handle = client.getHandle(AGENT_CHAT_CATALOG_WORKFLOW_ID);
  let result;
  try {
    result = await handle.query(resolveAgentChatBindingQuery, binding);
  } catch (error: unknown) {
    if (error instanceof WorkflowNotFoundError) return undefined;
    throw error;
  }
  return result === undefined
    ? undefined
    : AgentChatCatalogEntrySchema.parse(result);
}

export async function getAgentChat(
  client: WorkflowClient,
  chatId: string,
): Promise<AgentChatCatalogEntry | undefined> {
  const handle = client.getHandle(AGENT_CHAT_CATALOG_WORKFLOW_ID);
  let result;
  try {
    result = await handle.query(getAgentChatCatalogEntryQuery, chatId);
  } catch (error: unknown) {
    if (!(error instanceof WorkflowNotFoundError)) throw error;
  }
  if (result !== undefined) return AgentChatCatalogEntrySchema.parse(result);
  try {
    const state = AgentChatWorkflowStateSchema.parse(
      await client
        .getHandle(agentChatWorkflowId(chatId))
        .query(getAgentChatStateQuery),
    );
    return catalogEntryFromWorkflowState(state);
  } catch (error: unknown) {
    if (error instanceof WorkflowNotFoundError) return undefined;
    throw error;
  }
}

export async function listAgentChats(
  client: WorkflowClient,
): Promise<AgentChatCatalogEntry[]> {
  const handle = client.getHandle(AGENT_CHAT_CATALOG_WORKFLOW_ID);
  try {
    return AgentChatCatalogEntrySchema.array().parse(
      await handle.query(listAgentChatsQuery),
    );
  } catch (error: unknown) {
    if (error instanceof WorkflowNotFoundError) return [];
    throw error;
  }
}

async function bindTurnSource(input: {
  client: WorkflowClient;
  config: AgentChatConfig;
  request: AgentChatTurnRequest;
  enabled: boolean;
  purpose: "initial" | "restore";
}): Promise<void> {
  if (
    input.enabled &&
    (input.request.source.kind === "imessage" ||
      input.request.source.kind === "discord")
  ) {
    await bindAgentChat(
      input.client,
      input.request.source,
      input.config.chatId,
      {
        updatedAt: input.request.submittedAt,
        purpose: input.purpose,
      },
    );
  }
}

async function restoreTurnSource(input: {
  client: WorkflowClient;
  config: AgentChatConfig;
  request: AgentChatTurnRequest;
  enabled: boolean;
}): Promise<void> {
  if (!input.enabled) return;
  await registerAgentChat(input.client, input.config);
  await bindTurnSource({ ...input, purpose: "restore" });
}

export async function runAgentChatTurn(input: {
  client: WorkflowClient;
  config: AgentChatConfig;
  request: AgentChatTurnRequest;
  bindSource?: boolean;
}): Promise<AgentChatTurnResult> {
  const config = AgentChatConfigSchema.parse(input.config);
  const request = AgentChatTurnRequestSchema.parse(input.request);
  const catalogEntry = await registerAgentChat(input.client, config);
  const shouldBindSource = input.bindSource === true;

  const receiptWorkflowId = agentChatReceiptWorkflowId(
    config.chatId,
    request.turnId,
  );
  let receipt;
  try {
    receipt = await input.client.start<AgentChatReceiptWorkflow>(
      "agentChatTurnReceiptWorkflow",
      {
        workflowId: receiptWorkflowId,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowExecutionTimeout: AGENT_CHAT_RECEIPT_WORKFLOW_TIMEOUT_MS,
        args: [{ config, request }],
      },
    );
  } catch (error: unknown) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    receipt =
      input.client.getHandle<AgentChatReceiptWorkflow>(receiptWorkflowId);
  }
  const owner = AgentChatReceiptInputSchema.parse(
    await receipt.query(getAgentChatReceiptInputQuery),
  );
  if (
    JSON.stringify(owner.config) !== JSON.stringify(config) ||
    !agentChatTurnRequestsMatch(owner.request, request)
  ) {
    throw new Error(
      `Agent chat turn ID ${request.turnId} was reused with a different request`,
    );
  }
  await bindTurnSource({
    client: input.client,
    config,
    request,
    enabled: shouldBindSource,
    purpose: "initial",
  });
  let rawResult: AgentChatTurnResult;
  try {
    try {
      rawResult = await receipt.executeUpdate(awaitAgentChatReceiptUpdate, {
        updateId: "result",
      });
    } catch (error: unknown) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
      rawResult = await receipt.result();
    }
    const result = AgentChatTurnResultSchema.parse(rawResult);
    await input.client
      .getHandle(AGENT_CHAT_CATALOG_WORKFLOW_ID)
      .executeUpdate(settleAgentChatTurnUpdate, {
        args: [catalogEntry, result.turnNumber, result.completedAt],
      });
    await restoreTurnSource({
      client: input.client,
      config,
      request,
      enabled: shouldBindSource,
    });
    return result;
  } catch (error: unknown) {
    try {
      await restoreTurnSource({
        client: input.client,
        config,
        request,
        enabled: shouldBindSource,
      });
    } catch (restorationError: unknown) {
      throw new AggregateError(
        [error, restorationError],
        "Agent chat turn failed and its source binding could not be restored",
        { cause: restorationError },
      );
    }
    throw error;
  }
}

export async function continueAgentChat(input: {
  client: WorkflowClient;
  request: AgentChatTurnRequest;
  chatId?: string;
}): Promise<AgentChatTurnResult> {
  const request = AgentChatTurnRequestSchema.parse(input.request);
  const entry =
    input.chatId === undefined
      ? request.source.kind === "schedule"
        ? undefined
        : await resolveAgentChatBinding(input.client, request.source)
      : await getAgentChat(input.client, input.chatId);
  if (entry === undefined) {
    if (input.chatId === undefined) {
      throw new AgentChatBindingNotFoundError();
    }
    throw new AgentChatNotFoundError(input.chatId);
  }
  return await runAgentChatTurn({
    client: input.client,
    config: entry.config,
    request,
    bindSource: true,
  });
}
