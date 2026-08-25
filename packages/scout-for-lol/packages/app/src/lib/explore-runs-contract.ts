import type {
  ExploreActiveRun,
  ExploreAttachPoint,
  ExploreMessage,
} from "@scout-for-lol/data";
import type { ExplorePendingTurn } from "#src/lib/explore-turn-state.ts";

/**
 * What a caller supplies to start an explore turn.
 *
 * Declared here rather than beside the React context that carries it: the
 * hooks which act on a turn need the shape, not the context object, and a hook
 * reaching into `components/` for a type inverts the app's composition order.
 */
export type StartExploreTurnInput = {
  conversationId: string | null;
  question: string | null;
  attach: ExploreAttachPoint;
  displayQuestion: string | null;
  leafIdAtStart: string | null;
};

/** The explore-run operations a consumer of the context can perform. */
export type ExploreRunsContextValue = {
  discoverySettled: boolean;
  pendingTurn: (conversationId: string | null) => ExplorePendingTurn | null;
  error: (conversationId: string | null) => string | null;
  clearError: (conversationId: string | null) => void;
  acknowledgeVisibleAnswer: (
    conversationId: string,
    messages: ExploreMessage[],
  ) => void;
  startTurn: (input: StartExploreTurnInput) => Promise<ExploreActiveRun | null>;
  stop: (conversationId: string | null) => void;
  status: (conversationId: string) => "running" | "completed" | "failed" | null;
};
