/**
 * Message types from the Agent SDK
 */
export interface AgentMessage {
  type: string;
  [key: string]: unknown;
}

export interface AgentReadyMessage {
  type: "ready";
  sessionId: string;
}

export interface AgentAssistantMessage {
  type: "assistant";
  content: unknown[];
}

export interface AgentResultMessage {
  type: "result";
  subtype: "success" | "error";
  result?: string;
  error?: string;
}

export interface AgentErrorMessage {
  type: "error";
  error: string;
}

export interface AgentInterruptedMessage {
  type: "interrupted";
}
