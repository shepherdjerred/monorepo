import {
  isAgentChatBindingConflictError,
  type AgentChatBindingUpdate,
} from "#shared/agent/agent-chat.ts";

export class AgentChatRegistrationConflictError extends Error {
  public constructor(chatId: string) {
    super(
      `Durable agent chat ID ${chatId} was reused with different configuration`,
    );
    this.name = "AgentChatRegistrationConflictError";
  }
}

export function sourceOrdering(input: {
  sourceSequence: string | number;
  sourceEpoch?: string | number | undefined;
}): Pick<AgentChatBindingUpdate, "sourceSequence" | "sourceEpoch"> {
  return input.sourceEpoch === undefined
    ? { sourceSequence: input.sourceSequence }
    : { sourceSequence: input.sourceSequence, sourceEpoch: input.sourceEpoch };
}

export function ingressTimestamp(
  submittedAt: string | undefined,
  now: string,
): string {
  return submittedAt ?? now;
}

export function conflictMessage(error: unknown): string | undefined {
  if (error instanceof AgentChatRegistrationConflictError) {
    return error.message;
  }
  if (isAgentChatBindingConflictError(error)) {
    return error instanceof Error ? error.message : "binding conflict";
  }
  return undefined;
}
