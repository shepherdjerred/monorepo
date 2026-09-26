import {
  ApplicationFailure,
  allHandlersFinished,
  condition,
  continueAsNew,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  AgentChatTurnRequestSchema,
  AgentChatTurnResultSchema,
  AgentChatWorkflowInputSchema,
  AgentChatWorkflowStateSchema,
  agentChatTurnRequestsMatch,
  AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS,
  MAX_AGENT_CHAT_PENDING_TURNS,
  AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS,
  AGENT_CHAT_TURN_TIMEOUT_MS,
  type AgentChatActivities,
  type AgentChatSettledTurn,
  type AgentChatTurnRequest,
  type AgentChatTurnResult,
  type AgentChatWorkflowInput,
  type AgentChatWorkflowState,
  boundAgentChatFailureMessage,
} from "#shared/agent/agent-chat.ts";
import {
  getAgentChatStateQuery,
  runAgentChatTurnUpdate,
} from "#shared/agent/agent-chat-workflow.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const MAX_RECENT_TURNS = 100;
const MAX_RECENT_TURNS_BYTES = 1_000_000;

const activities = proxyActivities<AgentChatActivities>({
  taskQueue: TASK_QUEUES.AGENT_TASK,
  scheduleToStartTimeout: AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS,
  startToCloseTimeout: AGENT_CHAT_TURN_TIMEOUT_MS,
  scheduleToCloseTimeout: AGENT_CHAT_PROVIDER_SCHEDULE_TO_CLOSE_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});

function restoredState(input: AgentChatWorkflowInput): AgentChatWorkflowState {
  if (input.restoredState === undefined) {
    return {
      schemaVersion: 1,
      config: input.config,
      nextTurnNumber: 1,
      queuedTurnIds: [],
      recentTurns: [],
    };
  }
  const restored = AgentChatWorkflowStateSchema.parse(input.restoredState);
  if (JSON.stringify(restored.config) !== JSON.stringify(input.config)) {
    throw new Error("Restored agent chat configuration does not match input");
  }
  if (
    restored.activeTurnId !== undefined ||
    restored.queuedTurnIds.length > 0
  ) {
    throw new Error("Agent chat cannot restore with unsettled turns");
  }
  return restored;
}

function settledTurn(
  state: AgentChatWorkflowState,
  turnId: string,
): AgentChatSettledTurn | undefined {
  return state.recentTurns.find((turn) => turn.request.turnId === turnId);
}

function settledResult(turn: AgentChatSettledTurn): AgentChatTurnResult {
  if (turn.status === "completed") return turn.result;
  throw ApplicationFailure.nonRetryable(
    `Agent chat turn previously failed: ${turn.message}`,
    "AgentChatTurnPreviouslyFailed",
  );
}

function requireMatchingRequest(
  previous: AgentChatTurnRequest,
  incoming: AgentChatTurnRequest,
): void {
  if (!agentChatTurnRequestsMatch(previous, incoming)) {
    throw ApplicationFailure.nonRetryable(
      `Agent chat turn ID ${incoming.turnId} was reused with a different request`,
      "AgentChatTurnIdConflict",
    );
  }
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return boundAgentChatFailureMessage(message);
}

function rememberTurn(
  state: AgentChatWorkflowState,
  turn: AgentChatSettledTurn,
): void {
  state.recentTurns.push(turn);
  if (state.recentTurns.length > MAX_RECENT_TURNS) {
    state.recentTurns.splice(0, state.recentTurns.length - MAX_RECENT_TURNS);
  }
  while (
    state.recentTurns.length > 1 &&
    new TextEncoder().encode(JSON.stringify(state.recentTurns)).byteLength >
      MAX_RECENT_TURNS_BYTES
  ) {
    state.recentTurns.shift();
  }
}

function providerResumeState(
  state: AgentChatWorkflowState,
):
  | Record<string, never>
  | { providerSessionId: string; priorSessionManifestKey: string } {
  if (state.providerSessionId === undefined) return {};
  if (state.providerSessionManifestKey === undefined) {
    throw new Error("Agent chat provider session is missing its manifest key");
  }
  return {
    providerSessionId: state.providerSessionId,
    priorSessionManifestKey: state.providerSessionManifestKey,
  };
}

async function executeTurn(
  state: AgentChatWorkflowState,
  pendingRequests: Map<string, AgentChatTurnRequest>,
  rawRequest: AgentChatTurnRequest,
): Promise<AgentChatTurnResult> {
  const request = AgentChatTurnRequestSchema.parse(rawRequest);
  const prior = settledTurn(state, request.turnId);
  if (prior !== undefined) {
    requireMatchingRequest(prior.request, request);
    return settledResult(prior);
  }

  const pending = pendingRequests.get(request.turnId);
  if (pending !== undefined) {
    requireMatchingRequest(pending, request);
    await condition(() => settledTurn(state, request.turnId) !== undefined);
    const duplicateResult = settledTurn(state, request.turnId);
    if (duplicateResult === undefined) {
      throw new Error(`Agent chat turn ${request.turnId} did not settle`);
    }
    return settledResult(duplicateResult);
  }

  if (pendingRequests.size >= MAX_AGENT_CHAT_PENDING_TURNS) {
    throw ApplicationFailure.nonRetryable(
      `Agent chat ${state.config.chatId} already has ${String(MAX_AGENT_CHAT_PENDING_TURNS)} pending turns`,
      "AgentChatQueueFull",
    );
  }

  pendingRequests.set(request.turnId, request);
  state.queuedTurnIds.push(request.turnId);
  await condition(
    () =>
      state.activeTurnId === undefined &&
      state.queuedTurnIds[0] === request.turnId,
  );
  state.queuedTurnIds.shift();
  state.activeTurnId = request.turnId;
  const turnNumber = state.nextTurnNumber;

  try {
    if (
      request.providerStartDeadline !== undefined &&
      Date.now() >= Date.parse(request.providerStartDeadline)
    ) {
      throw ApplicationFailure.nonRetryable(
        `Agent chat turn ${request.turnId} exceeded its provider admission deadline`,
        "AgentChatTurnExpired",
      );
    }
    const result = AgentChatTurnResultSchema.parse(
      await activities.runAgentChatTurn({
        config: state.config,
        request,
        turnNumber,
        ...providerResumeState(state),
      }),
    );
    if (result.turnId !== request.turnId || result.turnNumber !== turnNumber) {
      throw new Error("Agent chat activity returned the wrong turn identity");
    }
    state.providerSessionId = result.providerSessionId;
    state.providerSessionManifestKey = result.sessionManifestKey;
    state.nextTurnNumber += 1;
    rememberTurn(state, { status: "completed", request, result });
    return result;
  } catch (error: unknown) {
    rememberTurn(state, {
      status: "failed",
      request,
      message: boundedErrorMessage(error),
      failedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    state.activeTurnId = undefined;
    pendingRequests.delete(request.turnId);
  }
}

export async function agentChatWorkflow(
  rawInput: AgentChatWorkflowInput,
): Promise<never> {
  const input = AgentChatWorkflowInputSchema.parse(rawInput);
  const state = restoredState(input);
  const pendingRequests = new Map<string, AgentChatTurnRequest>();

  setHandler(getAgentChatStateQuery, () =>
    AgentChatWorkflowStateSchema.parse(state),
  );
  setHandler(runAgentChatTurnUpdate, (request) => {
    if (workflowInfo().continueAsNewSuggested) {
      throw ApplicationFailure.nonRetryable(
        "Agent chat is draining for workflow rollover",
        "AgentChatRollover",
      );
    }
    return executeTurn(state, pendingRequests, request);
  });

  await condition(
    () =>
      workflowInfo().continueAsNewSuggested &&
      state.activeTurnId === undefined &&
      state.queuedTurnIds.length === 0 &&
      allHandlersFinished(),
  );

  return continueAsNew<typeof agentChatWorkflow>({
    config: state.config,
    restoredState: AgentChatWorkflowStateSchema.parse(state),
  });
}
