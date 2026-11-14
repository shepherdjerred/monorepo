import { ExploreConversationBusyError } from "#src/explore/rate-limit.ts";
import {
  ExploreRunRateLimitedError,
  ExploreRunUnavailableError,
} from "#src/explore/runs/run-manager.ts";
import {
  ExploreInvalidTurnError,
  ExploreNotFoundError,
} from "#src/explore/store.ts";

/**
 * Why `exploreRunManager.start` refused a turn, in terms every surface maps
 * to its own answer: tRPC to an error code, Scout Desktop to a contract
 * refusal. One classification keeps the surfaces from drifting apart.
 */
export type ExploreStartRefusal =
  | { readonly kind: "busy"; readonly message: string }
  | {
      readonly kind: "rate_limited";
      readonly message: string;
      readonly retryAfterSeconds: number;
    }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "invalid_turn"; readonly message: string };

/** The refusal a start error means, or null for an unexpected error. */
export function classifyExploreStartError(
  error: unknown,
): ExploreStartRefusal | null {
  if (error instanceof ExploreConversationBusyError) {
    return { kind: "busy", message: error.message };
  }
  if (error instanceof ExploreRunRateLimitedError) {
    return {
      kind: "rate_limited",
      message: error.message,
      retryAfterSeconds: error.rejection.retryAfterSeconds,
    };
  }
  if (error instanceof ExploreRunUnavailableError) {
    return { kind: "unavailable", message: error.message };
  }
  if (error instanceof ExploreNotFoundError) {
    return { kind: "not_found", message: error.message };
  }
  return error instanceof ExploreInvalidTurnError
    ? { kind: "invalid_turn", message: error.message }
    : null;
}
