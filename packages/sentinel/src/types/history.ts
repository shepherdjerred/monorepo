export type ConversationEntry = {
  timestamp: string;
  sessionId: string;
  agent: string;
  jobId: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  content: string;
  toolName?: string;
  turnNumber: number;
  model?: string;
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export type SessionSummary = {
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  durationMs: number;
  outcome: "completed" | "failed" | "timeout";
};
