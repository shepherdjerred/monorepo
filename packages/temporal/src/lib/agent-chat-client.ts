import {
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  type WorkflowClient,
} from "@temporalio/client";
import { createHash } from "node:crypto";
import {
  AGENT_CHAT_CATALOG_WORKFLOW_ID,
  AgentChatBindingSchema,
  AgentChatCatalogEntrySchema,
  AgentChatConfigSchema,
  AgentChatTurnRequestSchema,
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
  getAgentChatReceiptInputQuery,
  awaitAgentChatReceiptUpdate,
  type AgentChatReceiptInput,
} from "#shared/agent/agent-chat-receipt.ts";
import {
  bindAgentChatUpdate,
  getAgentChatCatalogEntryQuery,
  getAgentChatStateQuery,
  listAgentChatsQuery,
  registerAgentChatUpdate,
  recordAgentChatTurnUpdate,
  resolveAgentChatBindingQuery,
} from "#shared/agent/agent-chat-workflow.ts";

type AgentChatCatalogWorkflow = (
  state?: AgentChatCatalogState,
) => Promise<never>;
type AgentChatWorkflow = (input: AgentChatWorkflowInput) => Promise<never>;
type AgentChatReceiptWorkflow = (
  input: AgentChatReceiptInput,
) => Promise<never>;

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
  const entry = AgentChatCatalogEntrySchema.parse({
    schemaVersion: 1,
    config,
    updatedAt: config.createdAt,
    turnCount: 0,
  });
  return await client.executeUpdateWithStart(registerAgentChatUpdate, {
    args: [entry],
    startWorkflowOperation: catalogStart(),
  });
}

export async function bindAgentChat(
  client: WorkflowClient,
  rawBinding: AgentChatBinding,
  chatId: string,
  updatedAt: string,
): Promise<AgentChatCatalogEntry> {
  const binding = AgentChatBindingSchema.parse(rawBinding);
  const updateId = createHash("sha256")
    .update(JSON.stringify({ binding, chatId, updatedAt }))
    .digest("hex");
  return await client.executeUpdateWithStart(bindAgentChatUpdate, {
    args: [binding, chatId, updatedAt],
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

export async function runAgentChatTurn(input: {
  client: WorkflowClient;
  config: AgentChatConfig;
  request: AgentChatTurnRequest;
  bindSource?: boolean;
}): Promise<AgentChatTurnResult> {
  const config = AgentChatConfigSchema.parse(input.config);
  const request = AgentChatTurnRequestSchema.parse(input.request);
  await registerAgentChat(input.client, config);
  if (
    input.bindSource === true &&
    (request.source.kind === "imessage" || request.source.kind === "discord")
  ) {
    await bindAgentChat(
      input.client,
      request.source,
      config.chatId,
      request.submittedAt,
    );
  }

  const receipt = await input.client.start<AgentChatReceiptWorkflow>(
    "agentChatTurnReceiptWorkflow",
    {
      workflowId: agentChatReceiptWorkflowId(config.chatId, request.turnId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [{ config, request }],
    },
  );
  const owner = AgentChatReceiptInputSchema.parse(
    await receipt.query(getAgentChatReceiptInputQuery),
  );
  if (JSON.stringify(owner) !== JSON.stringify({ config, request })) {
    throw new Error(
      `Agent chat turn ID ${request.turnId} was reused with a different request`,
    );
  }
  const result = await receipt.executeUpdate(awaitAgentChatReceiptUpdate, {
    updateId: "result",
  });
  await input.client
    .getHandle(AGENT_CHAT_CATALOG_WORKFLOW_ID)
    .executeUpdate(recordAgentChatTurnUpdate, {
      args: [config.chatId, result.turnNumber, result.completedAt],
    });
  return result;
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
    throw new Error(
      input.chatId === undefined
        ? "No active durable agent chat is bound to this ingress conversation"
        : `Unknown durable agent chat: ${input.chatId}`,
    );
  }
  return await runAgentChatTurn({
    client: input.client,
    config: entry.config,
    request,
    bindSource: true,
  });
}
