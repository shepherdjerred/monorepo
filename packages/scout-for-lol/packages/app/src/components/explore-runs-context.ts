import { createContext, useContext } from "react";
import type { ExploreRunsContextValue } from "#src/lib/explore-runs-contract.ts";

export const ExploreRunsContext = createContext<ExploreRunsContextValue | null>(
  null,
);

export function useExploreRuns(): ExploreRunsContextValue {
  const value = useContext(ExploreRunsContext);
  if (value === null) {
    throw new Error("useExploreRuns must be used inside ExploreRunsProvider.");
  }
  return value;
}
