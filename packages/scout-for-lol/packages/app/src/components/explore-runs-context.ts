import { createContext, useContext } from "react";
import type { ExploreActiveRun, ExploreAttachPoint } from "@scout-for-lol/data";
import type { ExplorePendingTurn } from "#src/lib/explore-turn-state.ts";

export type StartExploreTurnInput = {
  conversationId: string | null;
  question: string | null;
  attach: ExploreAttachPoint;
  displayQuestion: string | null;
  leafIdAtStart: string | null;
};

export type ExploreRunsContextValue = {
  discoverySettled: boolean;
  pendingTurn: (conversationId: string | null) => ExplorePendingTurn | null;
  error: (conversationId: string | null) => string | null;
  clearError: (conversationId: string | null) => void;
  startTurn: (input: StartExploreTurnInput) => Promise<ExploreActiveRun | null>;
  stop: (conversationId: string | null) => void;
  status: (conversationId: string) => "running" | "completed" | "failed" | null;
};

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
