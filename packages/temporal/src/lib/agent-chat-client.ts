import {
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  type WorkflowClient,
} from "@temporalio/client";
import {
  AGENT_CHAT_CATALOG_WORKFLOW_ID,
  AgentChatBindingSchema,
  AgentChatCatalogEntrySchema,
  AgentChatConfigSchema,
  AgentChatTurnRequestSchema,
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
import {
  bindAgentChatUpdate,
  getAgentChatCatalogEntryQuery,
  listAgentChatsQuery,
  runAgentChatTurnUpdate,
  registerAgentChatUpdate,
  recordAgentChatTurnUpdate,
  resolveAgentChatBindingQuery,
} from "#shared/agent/agent-chat-workflow.ts";
import { WorkflowNotFoundError } from "@temporalio/common";

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
  if ((await getAgentChat(client, chatId)) === undefined) {
    throw new AgentChatNotFoundError(chatId);
  }
  return await client.executeUpdateWithStart(bindAgentChatUpdate, {
    args: [binding, chatId, updatedAt],
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
    if (error instanceof WorkflowNotFoundError) return undefined;
    throw error;
  }
  return result === undefined
    ? undefined
    : AgentChatCatalogEntrySchema.parse(result);
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

  const start = new WithStartWorkflowOperation<AgentChatWorkflow>(
    "agentChatWorkflow",
    {
      workflowId: agentChatWorkflowId(config.chatId),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [{ config }],
    },
  );
  const result = await input.client.executeUpdateWithStart(
    runAgentChatTurnUpdate,
    {
      args: [request],
      startWorkflowOperation: start,
    },
  );
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
