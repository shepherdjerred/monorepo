import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { FeatureFlags } from "@clauderon/shared";
import { useClauderonClient } from "@shepherdjerred/clauderon/web/frontend/src/hooks/useClauderonClient";

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

  ;

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
