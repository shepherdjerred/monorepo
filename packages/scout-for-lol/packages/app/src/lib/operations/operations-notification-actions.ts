import { z } from "zod";
import {
  notificationDrafts,
  resolveDeliveryDraft,
  type OperationsRequestDraft,
} from "#src/lib/operations/operations-payloads.ts";

/**
 * Which notification operations a given intent can actually succeed at.
 *
 * Shared by the queue table and the match inspector, because the rule is a
 * property of the intent rather than of the surface showing it — and because
 * the two surfaces disagreeing about what is offerable is exactly how an
 * operator learns to ignore a refusal.
 *
 * The rules come from the domain, not from the query that produced the row:
 *
 * - `pending` / `ready` are the only states a notification Workflow can pick
 *   up, so only those offer a re-drive.
 * - A re-drive is withdrawn once the freshness deadline has passed, because
 *   the machine refuses a send past it as `freshness-deadline-passed`.
 * - Suppression is offered ONLY once that deadline has passed, because
 *   `suppressStale` answers `not-stale` before it. The two are therefore
 *   mutually exclusive, and one of them is always the wrong thing to show.
 * - `sending` offers nothing at all: the machine leaves it only by recording
 *   the outcome as unknown and then having an operator answer it.
 *
 * Deciding from the row's own `freshnessDeadline` rather than from knowledge
 * of a WHERE clause is deliberate. Today the stalled-notification read bounds
 * the deadline to the future, so suppression never appears there; if that bound
 * is ever relaxed the row will start proving the opposite and this will follow
 * it, instead of silently offering an action that always refuses.
 */

const NotificationStateKindSchema = z.enum([
  "pending",
  "ready",
  "sending",
  "delivered",
  "suppressed",
  "expired",
  "permission-denied",
  "unknown-delivery",
]);
export type NotificationStateKind = z.infer<typeof NotificationStateKindSchema>;

/**
 * Why an intent offers nothing, and how loudly to say it.
 *
 * The two tones are not decoration. A `rule` is the machine working as
 * designed — a sending intent, a settled one — and reads as ordinary detail.
 * A `contract-violation` is the read disagreeing with the domain, which under
 * contract-hash coupling means the backend and this SPA shipped out of step or
 * a stored row is malformed. That is an incident in itself, so it is rendered
 * as an error and asks to be reported rather than sitting quietly in grey.
 */
export type NotificationBlocked = {
  readonly tone: "rule" | "contract-violation";
  readonly message: string;
};

export type NotificationActions = {
  /**
   * Why this intent offers nothing, when it offers nothing. Rendered instead
   * of an empty cell so the absence reads as a stated reason rather than a gap.
   */
  readonly blocked: NotificationBlocked | null;
  readonly drafts: readonly OperationsRequestDraft[];
};

export function notificationActions(input: {
  readonly intentKey: string;
  /**
   * The row's state. Taken as a string because the queue read widens the
   * domain union to one; a value outside the union offers nothing and says so,
   * rather than being guessed at or throwing and taking the whole console down
   * mid-incident. Nothing is inferred from an unrecognised state — the row is
   * simply not actionable, visibly.
   */
  readonly state: string;
  /** The instant after which the machine refuses to send, as an ISO string. */
  readonly freshnessDeadline: string;
  /**
   * One evaluation-time clock for the whole page. Passed in rather than read
   * per row so a page cannot straddle the boundary and give two equally-fresh
   * intents different answers.
   */
  readonly now: number;
  /** Present only on the states that carry one. */
  readonly attemptNonce?: string;
}): NotificationActions {
  const { intentKey } = input;
  const parsed = NotificationStateKindSchema.safeParse(input.state);
  if (!parsed.success) {
    return {
      blocked: {
        tone: "contract-violation",
        message: `Unrecognised state: ${input.state}. This is a contract violation — report it. Scout will not offer an operation for a state it cannot reason about.`,
      },
      drafts: [],
    };
  }
  switch (parsed.data) {
    case "pending":
    case "ready": {
      const stale = new Date(input.freshnessDeadline).getTime() <= input.now;
      return {
        blocked: null,
        drafts: stale
          ? [notificationDrafts(intentKey).suppress]
          : [notificationDrafts(intentKey).retry],
      };
    }
    case "unknown-delivery": {
      const attemptNonce = input.attemptNonce;
      if (attemptNonce === undefined) {
        // The domain puts a nonce on this state, so its absence is the read
        // disagreeing with the machine — the same class of break as an
        // unrecognised state, and reported as loudly.
        return {
          blocked: {
            tone: "contract-violation",
            message:
              "Unknown-delivery with no attempt nonce recorded. This is a contract violation — report it. Scout will not answer an attempt it cannot name.",
          },
          drafts: [],
        };
      }
      return {
        blocked: null,
        drafts: [resolveDeliveryDraft({ intentKey, attemptNonce })],
      };
    }
    case "sending":
      return {
        blocked: {
          tone: "rule",
          message:
            "A sending intent cannot be re-driven. The machine only leaves sending once the outcome is recorded as unknown and then answered.",
        },
        drafts: [],
      };
    case "delivered":
    case "suppressed":
    case "expired":
    case "permission-denied":
      return {
        blocked: { tone: "rule", message: "This intent has settled." },
        drafts: [],
      };
  }
}
