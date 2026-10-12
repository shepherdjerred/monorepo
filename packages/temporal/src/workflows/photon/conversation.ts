import {
  ApplicationFailure,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/common";
import {
  allHandlersFinished,
  condition,
  continueAsNew,
  log,
  isCancellation,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  startChild,
  workflowInfo,
  WorkflowIdReusePolicy,
} from "@temporalio/workflow";
import { AGENT_CHAT_IMESSAGE_COMMAND_WORKFLOW_TIMEOUT_MS } from "#shared/agent/agent-chat.ts";
import {
  admitPhotonMessageUpdate,
  MAX_PHOTON_PENDING_COMMANDS,
  MAX_PHOTON_STATE_BYTES,
  PHOTON_RECENT_COMMANDS,
  PHOTON_ROLLOVER_COMMANDS,
  PhotonConversationStateSchema,
  PhotonMessageSchema,
  photonCommandWorkflowId,
  photonConversationStateQuery,
  type PhotonActivities,
  type PhotonAdmission,
  type PhotonConversationState,
} from "#shared/agent/agent-chat-photon.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { photonAgentChatWorkflow } from "./message.ts";

const join = proxyActivities<Pick<PhotonActivities, "waitForPhotonCommand">>({
  taskQueue: TASK_QUEUES.AGENT_CHAT_INGRESS,
  startToCloseTimeout: AGENT_CHAT_IMESSAGE_COMMAND_WORKFLOW_TIMEOUT_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

export async function photonConversationWorkflow(
  rawState: PhotonConversationState,
): Promise<never> {
  const state = PhotonConversationStateSchema.parse(rawState);
  let draining = false;
  setHandler(photonConversationStateQuery, () => state);
  setHandler(admitPhotonMessageUpdate, (rawMessage): PhotonAdmission => {
    const message = PhotonMessageSchema.parse(rawMessage);
    if (message.conversationId !== state.conversationId)
      throw ApplicationFailure.nonRetryable(
        "Photon conversation mismatch",
        "PhotonMessageConflict",
      );
    const previous =
      state.pending.find((item) => item.messageId === message.messageId) ??
      state.recent.find((item) => item.messageId === message.messageId);
    if (previous !== undefined) {
      if (previous.fingerprint !== message.fingerprint)
        throw ApplicationFailure.nonRetryable(
          "Photon message ID reused with different content",
          "PhotonMessageConflict",
        );
      return { status: "duplicate", pending: state.pending.length };
    }
    if (draining || state.pending.length >= MAX_PHOTON_PENDING_COMMANDS)
      throw ApplicationFailure.nonRetryable(
        "Photon conversation admission is temporarily full",
        "PhotonQueueFull",
      );
    const command = {
      ...message,
      sourceSequence: state.nextSequence,
      sourceEpoch: 1 as const,
      outOfOrder:
        state.latestTimestamp !== undefined &&
        Date.parse(message.submittedAt) < Date.parse(state.latestTimestamp),
    };
    const candidate = {
      ...state,
      pending: [...state.pending, command],
      recent: [
        ...state.recent,
        { messageId: message.messageId, fingerprint: message.fingerprint },
      ].slice(-PHOTON_RECENT_COMMANDS),
      nextSequence: state.nextSequence + 1,
      latestTimestamp: command.outOfOrder
        ? state.latestTimestamp
        : message.submittedAt,
    };
    if (
      new TextEncoder().encode(JSON.stringify(candidate)).byteLength >
        MAX_PHOTON_STATE_BYTES ||
      !Number.isSafeInteger(candidate.nextSequence)
    )
      throw ApplicationFailure.nonRetryable(
        "Photon conversation admission is temporarily full",
        "PhotonQueueFull",
      );
    Object.assign(state, candidate);
    return { status: "accepted", pending: state.pending.length };
  });
  for (
    let completed = 0;
    completed < PHOTON_ROLLOVER_COMMANDS;
    completed += 1
  ) {
    await condition(
      () => state.pending.length > 0 || workflowInfo().continueAsNewSuggested,
    );
    const command = state.pending[0];
    if (command === undefined) break;
    const workflowId = photonCommandWorkflowId(command.messageId);
    try {
      const child = await startChild(photonAgentChatWorkflow, {
        workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [command],
        parentClosePolicy: ParentClosePolicy.ABANDON,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowExecutionTimeout:
          AGENT_CHAT_IMESSAGE_COMMAND_WORKFLOW_TIMEOUT_MS,
      });
      try {
        await child.result();
      } catch (error: unknown) {
        if (isCancellation(error)) throw error;
        log.error(
          "Photon command failed; inspect its durable execution before retrying",
          { workflowId },
        );
      }
    } catch (error: unknown) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
      // Advance only after the existing command is known to have settled.
      await join.waitForPhotonCommand(workflowId, command);
    }
    state.pending.shift();
    if (workflowInfo().continueAsNewSuggested) break;
  }
  draining = true;
  await condition(allHandlersFinished);
  return await continueAsNew<typeof photonConversationWorkflow>(state);
}
