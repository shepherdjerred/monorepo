import { createContext, useContext, useState, type ReactNode } from "react";
import type { FeatureFlags } from "@clauderon/shared";

type FeatureFlagsContextValue = {
  flags: FeatureFlags | null;
  isLoading: boolean;
  error: Error | null;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(
  null,
);

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags] = useState<FeatureFlags | null>(null);
  const [isLoading] = useState(true);
  const [error] = useState<Error | null>(null);

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
