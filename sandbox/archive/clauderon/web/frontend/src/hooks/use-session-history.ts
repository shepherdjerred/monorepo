import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { parseMessages, type Message } from "@/lib/claude-parser";

export type HistoryState = {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  fileExists: boolean;
};

/**
 * Hook to fetch and poll session history from JSONL file
 */
export function useSessionHistory(
  sessionId: string | null,
  pollingInterval = 2000,
): HistoryState {
  const query = useQuery({
    queryKey: ["session-history", sessionId],
    queryFn: async () => {
      if (sessionId == null) {
        throw new Error("No session ID");
      }
      return apiClient.getSessionHistory(sessionId);
    },
    enabled: sessionId != null,
    refetchInterval: pollingInterval,
    staleTime: 1000,
  });

  if (query.data == null) {
    return {
      messages: [],
      isLoading: query.isLoading,
      error: query.error instanceof Error ? query.error.message : null,
      fileExists: false,
    };
  }

  const terminalOutput = query.data.lines.join("\n");
  const messages = parseMessages(terminalOutput);

  return {
    messages,
    isLoading: false,
    error: null,
    fileExists: query.data.fileExists,
  };
}
