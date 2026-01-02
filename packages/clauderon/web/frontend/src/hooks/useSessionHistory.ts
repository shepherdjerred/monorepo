import { useEffect, useState, useRef } from "react";
import { ClauderonClient } from "@clauderon/client";
import { parseHistoryLines } from "../lib/historyParser";
import type { Message } from "../lib/claudeParser";

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
  pollingInterval = 2000
): HistoryState {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileExists, setFileExists] = useState(false);

  const lastLineRef = useRef(0);
  const clientRef = useRef(new ClauderonClient());

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setIsLoading(false);
      return;
    }

    let isActive = true;

    const fetchHistory = async () => {
      try {
        const client = clientRef.current;

        // Fetch new lines since last poll
        const response = await client.getSessionHistory(
          sessionId,
          lastLineRef.current,
          undefined // no limit
        );

        if (!isActive) {
          return;
        }

        setFileExists(response.fileExists);

        if (!response.fileExists) {
          setError(
            "History file does not exist yet. Start a conversation to create it."
          );
          setIsLoading(false);
          return;
        }

        if (response.lines.length > 0) {
          // Parse new messages
          const newMessages = parseHistoryLines(response.lines);

          // Append to existing messages
          setMessages((prev) => [...prev, ...newMessages]);

          // Update last line counter
          lastLineRef.current = response.totalLines;
        }

        setError(null);
        setIsLoading(false);
      } catch (err) {
        if (!isActive) {
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to fetch history");
        setIsLoading(false);
      }
    };

    // Initial fetch
    void fetchHistory();

    // Set up polling
    const intervalId = setInterval(() => {
      void fetchHistory();
    }, pollingInterval);

    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, [sessionId, pollingInterval]);

  return {
    messages,
    isLoading,
    error,
    fileExists,
  };
}
