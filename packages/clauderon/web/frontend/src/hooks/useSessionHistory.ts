import { useEffect, useState, useRef } from "react";
import { ClauderonClient } from "@clauderon/client";
import { parseHistoryLinesAuto } from "@shepherdjerred/clauderon/web/frontend/src/lib/historyParser";
import type { Message } from "@shepherdjerred/clauderon/web/frontend/src/lib/claudeParser";

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
 * @param pollingInterval Polling interval in ms (default: 2000)
 */
export function useSessionHistory(
  sessionId: string | null,
  pollingInterval = 2000,
): HistoryState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileExists, setFileExists] = useState(false);

  const lastLineRef = useRef(0);
  const clientRef = useRef(new ClauderonClient());

  ;

  return {
    messages,
    isLoading,
    error,
    fileExists,
  };
}
