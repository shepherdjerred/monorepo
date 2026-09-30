import {
  type AgentChatProvider,
  type AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import {
  AmbiguousManifestPublicationError,
  pushAgentChatSessionBundle,
} from "./session-bundle.ts";
import type { AgentChatObjectStore } from "./session-store.ts";

export async function publishAgentChatSession(input: {
  store: AgentChatObjectStore;
  prefix: string;
  chatId: string;
  provider: AgentChatProvider;
  turnNumber: number;
  turnId: string;
  providerSessionId: string;
  workspacePath: string;
  sessionHome: string;
  forbiddenTokens: readonly string[];
  turnResult: AgentChatTurnResult;
}): Promise<AmbiguousManifestPublicationError | undefined> {
  try {
    await pushAgentChatSessionBundle(input);
  } catch (error: unknown) {
    if (error instanceof AmbiguousManifestPublicationError) return error;
    throw error;
  }
  return undefined;
}
