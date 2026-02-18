import { useMemo } from "react";
import { ClauderonClient } from "@clauderon/client";

/**
 * Hook to get a configured ClauderonClient instance
 */
export function useClauderonClient() {
  return useMemo(() => new ClauderonClient(), []);
}
