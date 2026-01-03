import { useMemo } from "react";
import { ClauderonClient } from "../api/ClauderonClient";
import { useSettings } from "./useSettings";

/**
 * Hook to get a memoized Clauderon API client
 */
export function useClauderonClient(): ClauderonClient | null {
  const { daemonUrl } = useSettings();

  return useMemo(() => {
    if (!daemonUrl) {
      return null;
    }
    return new ClauderonClient({ baseUrl: daemonUrl });
  }, [daemonUrl]);
}
