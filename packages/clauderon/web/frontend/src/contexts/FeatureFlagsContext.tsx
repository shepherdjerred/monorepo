import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { FeatureFlags } from "@clauderon/shared";
import { useClauderonClient } from "../hooks/useClauderonClient";

type FeatureFlagsContextValue = {
  flags: FeatureFlags | null;
  isLoading: boolean;
  error: Error | null;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(
  null,
);

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const client = useClauderonClient();
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function loadFlags() {
      try {
        const response = await client.getFeatureFlags();
        setFlags(response.flags);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
      }
    }
    void loadFlags();
  }, [client]);

  return (
    <FeatureFlagsContext.Provider value={{ flags, isLoading, error }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  const context = useContext(FeatureFlagsContext);
  if (context === null) {
    throw new Error("useFeatureFlags must be used within FeatureFlagsProvider");
  }
  return context;
}
