import type { NotificationTargetKind } from "#src/notifications/intent.ts";
import type { RecoveryPolicy } from "#src/recovery/batch.ts";

/**
 * Whether a recovery policy lets one notification target be sent to.
 *
 * Lives in `recovery` rather than `notifications` on purpose: the layering
 * keeps ordinary delivery ignorant of who minted an intent, and this is the
 * recovery semantics that an intent born of a batch is delivered under. The
 * policy caps a recovery batch's external blast radius, and this is the one
 * place its three values are given delivery meaning:
 *
 * - `normal` permits every target; it is what a live-born intent runs under.
 * - `stale-private-only` permits private targets only: a DM reaches the one
 *   person who played, through `sendDM`'s own audited budget, while a channel
 *   would announce a stale game to a room. Channel intents under it are held.
 * - `no-external` permits nothing; every intent is held until an operator
 *   releases the batch to `stale-private-only`.
 *
 * A held intent is not failed and not suppressed. It stays where it is —
 * pending or ready — and proceeds only when the batch's policy widens, which
 * is the single sanctioned policy change and the one an operator release
 * performs. Exhaustive over both enums, so a new policy or target has to be
 * classified here before anything compiles.
 */
export type NotificationDeliveryDecision = "permitted" | "held";

export function notificationDeliveryDecision(
  policy: RecoveryPolicy,
  target: NotificationTargetKind,
): NotificationDeliveryDecision {
  switch (policy) {
    case "normal":
      return "permitted";
    case "stale-private-only":
      switch (target) {
        case "dm":
          return "permitted";
        case "channel":
          return "held";
        default: {
          const _exhaustive: never = target;
          return _exhaustive;
        }
      }
    case "no-external":
      return "held";
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}
