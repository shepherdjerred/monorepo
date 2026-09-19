import {
  ActivityFailure,
  ApplicationFailure,
  allHandlersFinished,
  condition,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import {
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_DISPATCH_MAX_ATTEMPTS,
  AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS,
  AGENT_CHAT_RECEIPT_ADMISSION_TIMEOUT_MS,
  AGENT_CHAT_RECEIPT_DISPATCH_TIMEOUT_MS,
  AgentChatTurnResultSchema,
  boundAgentChatFailureMessage,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import { collectErrorMessages } from "#shared/error-cause.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  AgentChatReceiptInputSchema,
  AgentChatPinnedResultSchema,
  getAgentChatReceiptInputQuery,
  awaitAgentChatReceiptUpdate,
  type AgentChatReceiptActivities,
  type AgentChatReceiptInput,
} from "#shared/agent/agent-chat-receipt.ts";

const locateActivities = proxyActivities<AgentChatReceiptActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_RECEIPTS,
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: AGENT_CHAT_GLOBAL_QUEUE_TIMEOUT_MS,
  retry: { maximumAttempts: AGENT_CHAT_DISPATCH_MAX_ATTEMPTS },
});
const dispatchActivities = proxyActivities<AgentChatReceiptActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_RECEIPTS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  scheduleToCloseTimeout: AGENT_CHAT_RECEIPT_DISPATCH_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_DISPATCH_MAX_ATTEMPTS },
});

type ReceiptOutcome =
  | { status: "completed"; result: AgentChatTurnResult }
  | { status: "failed"; message: string };

const TERMINAL_RECEIPT_FAILURE_TYPES = new Set([
  "AgentChatTurnPreviouslyFailed",
  "AgentChatConfigConflict",
  "AgentChatNotRunning",
  "AgentChatPinnedRunUnavailable",
  "AgentChatAdmissionUnavailable",
]);

function isTerminalReceiptFailure(error: unknown): boolean {
  const failure =
    error instanceof ActivityFailure &&
    error.cause instanceof ApplicationFailure
      ? error.cause
      : error;
  return (
    failure instanceof ApplicationFailure &&
    TERMINAL_RECEIPT_FAILURE_TYPES.has(failure.type ?? "")
  );
}

export async function agentChatTurnReceiptWorkflow(
  rawInput: AgentChatReceiptInput,
): Promise<AgentChatTurnResult> {
  const input = AgentChatReceiptInputSchema.parse(rawInput);
  const receiptDeadline =
    workflowInfo().startTime.getTime() +
    AGENT_CHAT_RECEIPT_ADMISSION_TIMEOUT_MS;
  const requestedDeadline = input.request.providerStartDeadline;
  const providerStartDeadline = new Date(
    requestedDeadline === undefined
      ? receiptDeadline
      : Math.min(receiptDeadline, Date.parse(requestedDeadline)),
  ).toISOString();
  const dispatchInput = AgentChatReceiptInputSchema.parse({
    ...input,
    request: { ...input.request, providerStartDeadline },
  });
  let outcome: ReceiptOutcome | undefined;
  let pinnedRunId: string | undefined;
  let redirects = 0;
  setHandler(getAgentChatReceiptInputQuery, () => input);
  setHandler(awaitAgentChatReceiptUpdate, async () => {
    await condition(() => outcome !== undefined);
    if (outcome === undefined)
      throw new Error("Agent chat receipt did not settle");
    if (outcome.status === "failed") {
      throw ApplicationFailure.nonRetryable(
        outcome.message,
        "AgentChatTurnPreviouslyFailed",
      );
    }
    return outcome.result;
  });
  while (outcome === undefined) {
    try {
      // Once selected, retain the run pin across exhausted Activity retries.
      // A redirect is safe only after the pinned run explicitly reports that it
      // continued as new without admitting this update.
      pinnedRunId ??= await locateActivities.locateAgentChatRun(dispatchInput);
      const pinned = AgentChatPinnedResultSchema.parse(
        await dispatchActivities.dispatchPinnedAgentChatTurn({
          ...dispatchInput,
          runId: pinnedRunId,
        }),
      );
      if (pinned.status === "completed") {
        outcome = {
          status: "completed",
          result: AgentChatTurnResultSchema.parse(pinned.result),
        };
        continue;
      }
      pinnedRunId = undefined;
      redirects += 1;
      if (redirects >= AGENT_CHAT_DISPATCH_MAX_ATTEMPTS) {
        throw ApplicationFailure.nonRetryable(
          "Agent chat kept rolling over before turn admission",
          "AgentChatAdmissionUnavailable",
        );
      }
    } catch (error: unknown) {
      if (isTerminalReceiptFailure(error)) {
        outcome = {
          status: "failed",
          message: boundAgentChatFailureMessage(collectErrorMessages(error)),
        };
      } else {
        // The pinned update ID and retained run ID make another dispatch safe
        // after transport or Temporal-client exhaustion.
        await sleep("30 seconds");
      }
    }
  }
  // Finish any update that was admitted by a worker running the prior client
  // before closing. Completed-history retention provides a bounded durable
  // deduplication window without one permanently open Workflow per turn.
  await condition(allHandlersFinished);
  if (outcome.status === "failed") {
    throw ApplicationFailure.nonRetryable(
      outcome.message,
      "AgentChatTurnPreviouslyFailed",
    );
  }
  return outcome.result;
}
