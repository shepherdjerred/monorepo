import { createHash } from "node:crypto";
import { ApplicationFailure } from "@temporalio/common";
import {
  WorkflowNotFoundError,
  WorkflowUpdateFailedError,
  type WorkflowClient,
} from "@temporalio/client";
import { collectErrorMessages } from "#shared/error-cause.ts";
import {
  agentChatWorkflowId,
  AgentChatTurnResultSchema,
  boundAgentChatFailureMessage,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  getAgentChatStateQuery,
  runAgentChatTurnUpdate,
} from "#shared/agent/agent-chat-workflow.ts";
import { AgentChatWorkflowStateSchema } from "#shared/agent/agent-chat.ts";
import {
  AgentChatReceiptInputSchema,
  AgentChatPinnedTurnSchema,
  type AgentChatPinnedTurn,
  type AgentChatReceiptInput,
  type AgentChatPinnedResult,
} from "#shared/agent/agent-chat-receipt.ts";

export function agentChatReceiptWorkflowId(
  chatId: string,
  turnId: string,
): string {
  const digest = createHash("sha256").update(turnId).digest("hex");
  return `${agentChatWorkflowId(chatId)}/turn/${digest}`;
}

export async function locateAgentChatRun(
  client: WorkflowClient,
  rawInput: AgentChatReceiptInput,
): Promise<string> {
  const input = AgentChatReceiptInputSchema.parse(rawInput);
  const handle = client.getHandle(agentChatWorkflowId(input.config.chatId));
  const state = AgentChatWorkflowStateSchema.parse(
    await handle.query(getAgentChatStateQuery),
  );
  if (JSON.stringify(state.config) !== JSON.stringify(input.config)) {
    throw ApplicationFailure.nonRetryable(
      "Agent chat receipt configuration does not match its owner",
      "AgentChatConfigConflict",
    );
  }
  const description = await handle.describe();
  if (description.status.name !== "RUNNING") {
    throw ApplicationFailure.nonRetryable(
      "Agent chat is not running",
      "AgentChatNotRunning",
    );
  }
  return description.runId;
}

async function rolloverPinnedResult(input: {
  handle: ReturnType<WorkflowClient["getHandle"]>;
  error: WorkflowUpdateFailedError;
}): Promise<AgentChatPinnedResult | undefined> {
  if (
    !collectErrorMessages(input.error).includes(
      "Agent chat is draining for workflow rollover",
    )
  ) {
    return undefined;
  }
  const description = await input.handle.describe();
  if (description.status.name === "CONTINUED_AS_NEW") {
    return { status: "run-closed" };
  }
  if (description.status.name === "RUNNING") {
    throw new Error("Pinned agent chat run is still draining for rollover", {
      cause: input.error,
    });
  }
  return undefined;
}

export async function dispatchPinnedAgentChatTurn(
  client: WorkflowClient,
  rawInput: AgentChatPinnedTurn,
): Promise<AgentChatPinnedResult> {
  const input = AgentChatPinnedTurnSchema.parse(rawInput);
  const handle = client.getHandle(
    agentChatWorkflowId(input.config.chatId),
    input.runId,
  );
  const updateId = `turn/${createHash("sha256").update(input.request.turnId).digest("hex")}`;
  try {
    try {
      const cached = await handle
        .getUpdateHandle<AgentChatTurnResult>(updateId)
        .result();
      return {
        status: "completed",
        result: AgentChatTurnResultSchema.parse(cached),
      };
    } catch (error: unknown) {
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
    const description = await handle.describe();
    if (description.status.name === "CONTINUED_AS_NEW")
      return { status: "run-closed" };
    if (description.status.name !== "RUNNING") {
      throw ApplicationFailure.nonRetryable(
        "Pinned agent chat run closed without a turn receipt",
        "AgentChatPinnedRunUnavailable",
      );
    }
    const result = await handle.executeUpdate(runAgentChatTurnUpdate, {
      updateId,
      args: [input.request],
    });
    return {
      status: "completed",
      result: AgentChatTurnResultSchema.parse(result),
    };
  } catch (error: unknown) {
    if (error instanceof WorkflowUpdateFailedError) {
      const messages = collectErrorMessages(error);
      const rollover = await rolloverPinnedResult({ handle, error });
      if (rollover !== undefined) return rollover;
      throw ApplicationFailure.create({
        message: boundAgentChatFailureMessage(messages),
        type: "AgentChatTurnPreviouslyFailed",
        nonRetryable: true,
        cause: error,
      });
    }
    // Retry an admission/rollover race against the SAME pin. The next attempt
    // polls its update before considering a safe redirect; missing history never redirects.
    throw error;
  }
}
