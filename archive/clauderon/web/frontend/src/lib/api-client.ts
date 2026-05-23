import { ClauderonClient } from "@clauderon/client";

/** Shared singleton client instance used by all query/mutation hooks. */
export const apiClient = new ClauderonClient();
