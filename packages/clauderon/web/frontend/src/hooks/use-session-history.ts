import { useState } from "react";
import type { Message } from "@/lib/claude-parser.ts";

export type HistoryState = {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  fileExists: boolean;
};

/**
 * Hook to fetch and poll session history from JSONL file
 *
 * @param sessionId Session ID to fetch history for
 * @param _pollingInterval Polling interval in ms (default: 2000)
 */
export function useSessionHistory(
  _sessionId: string | null,
  _pollingInterval = 2000,
): HistoryState {
  const [messages] = useState<Message[]>([]);
  const [isLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [fileExists] = useState(false);

  return {
    messages,
    isLoading,
    error,
    fileExists,
  };
}
