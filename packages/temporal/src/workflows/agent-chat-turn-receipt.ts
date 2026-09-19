import {
  ActivityFailure,
  ApplicationFailure,
  condition,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import {
  AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  AGENT_CHAT_DISPATCH_MAX_ATTEMPTS,
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
  retry: { maximumAttempts: AGENT_CHAT_DISPATCH_MAX_ATTEMPTS },
});
const dispatchActivities = proxyActivities<AgentChatReceiptActivities>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_RECEIPTS,
  startToCloseTimeout: AGENT_CHAT_COMMAND_WAIT_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: AGENT_CHAT_DISPATCH_MAX_ATTEMPTS },
});

type ReceiptOutcome =
  | { status: "completed"; result: AgentChatTurnResult }
  | { status: "failed"; message: string };

function isSettledTurnFailure(error: unknown): boolean {
  if (!(error instanceof ActivityFailure)) return false;
  const cause = error.cause;
  return (
    cause instanceof ApplicationFailure &&
    cause.type === "AgentChatTurnPreviouslyFailed"
  );
}

async function executeReceipt(
  input: AgentChatReceiptInput,
): Promise<AgentChatTurnResult> {
  for (
    let attempt = 0;
    attempt < AGENT_CHAT_DISPATCH_MAX_ATTEMPTS;
    attempt += 1
  ) {
    // The run pin is recorded in Workflow history before a turn can be admitted.
    const runId = await locateActivities.locateAgentChatRun(input);
    const outcome = AgentChatPinnedResultSchema.parse(
      await dispatchActivities.dispatchPinnedAgentChatTurn({ ...input, runId }),
    );
    if (outcome.status === "completed")
      return AgentChatTurnResultSchema.parse(outcome.result);
    // Redirection is allowed only when the old run closed without accepting this update.
  }
  throw ApplicationFailure.nonRetryable(
    "Agent chat kept rolling over before turn admission",
    "AgentChatAdmissionUnavailable",
  );
}

export async function agentChatTurnReceiptWorkflow(
  rawInput: AgentChatReceiptInput,
): Promise<never> {
  const input = AgentChatReceiptInputSchema.parse(rawInput);
  let outcome: ReceiptOutcome | undefined;
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
      outcome = { status: "completed", result: await executeReceipt(input) };
    } catch (error: unknown) {
      if (isSettledTurnFailure(error)) {
        outcome = {
          status: "failed",
          message: boundAgentChatFailureMessage(collectErrorMessages(error)),
        };
      } else {
        // The pinned update ID makes another dispatch safe after transport,
        // Temporal-client, or rollover exhaustion. Keep the durable receipt
        // retryable until the owner confirms a terminal turn outcome.
        await sleep("30 seconds");
      }
    }
  }
  // Remain open: completed-history retention must not expire idempotency receipts.
  await condition(() => false);
  throw new Error("Agent chat receipt must remain open");
}
