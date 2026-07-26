import { match } from "ts-pattern";

type SubscriptionResultKind =
  | "removed"
  | "updated"
  | "player-not-found"
  | "not-subscribed-in-channel"
  | "internal-error";

export type SubscriptionResultOutcome = {
  ok: boolean;
  message: string;
};

/**
 * Shared user-facing messages for the subscription remove/mute mutation
 * results, used by both the Subscriptions tab and the player page.
 */
export function removeResultOutcome(result: {
  kind: SubscriptionResultKind;
  message?: string;
}): SubscriptionResultOutcome {
  return match(result.kind)
    .with("removed", () => ({ ok: true, message: "Subscription removed." }))
    .with("player-not-found", () => ({
      ok: false,
      message: "Player not found.",
    }))
    .with("not-subscribed-in-channel", () => ({
      ok: false,
      message: "Player is not subscribed in that channel.",
    }))
    .otherwise(() => ({
      ok: false,
      message: result.message ?? "Something went wrong.",
    }));
}

export function muteResultOutcome(
  result: { kind: SubscriptionResultKind; message?: string },
  isMuted: boolean,
): SubscriptionResultOutcome {
  return match(result.kind)
    .with("updated", () => ({
      ok: true,
      message: isMuted
        ? "Subscription muted — no more match notifications."
        : "Subscription unmuted.",
    }))
    .with("player-not-found", () => ({
      ok: false,
      message: "Player not found.",
    }))
    .with("not-subscribed-in-channel", () => ({
      ok: false,
      message: "Player is not subscribed in that channel.",
    }))
    .otherwise(() => ({
      ok: false,
      message: result.message ?? "Something went wrong.",
    }));
}
