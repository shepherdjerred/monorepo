export type ConversationEntry = {
  timestamp: string;
  sessionId: string;
  agent: string;
  jobId: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  content: string;
  toolName?: string;
  toolInput?: string;
  toolUseId?: string;
  permissionDecision?: "allow" | "deny";
  turnNumber: number;
  model?: string;
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export type ModelUsageEntry = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
};

export type PermissionDenial = {
  toolName: string;
  toolInput: string;
};

export type SessionSummary = {
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  durationMs: number;
  outcome: "completed" | "failed" | "timeout";
  totalCostUsd?: number;
  durationApiMs?: number;
  modelUsage?: Record<string, ModelUsageEntry>;
  permissionDenials?: PermissionDenial[];
  systemPrompt?: string;
};
