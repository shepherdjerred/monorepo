import { match } from "ts-pattern";

export type SubscriptionResultOutcome = {
  ok: boolean;
  message: string;
};

/**
 * Exactly the variants `removeSubscription` returns (backend
 * `RemoveSubscriptionResult`). Extra per-variant payload fields are structurally
 * accepted — the helper only reads `kind` and, for failures, `message`.
 */
export type RemoveResultInput =
  | { kind: "removed" }
  | { kind: "not-subscribed-in-channel" }
  | { kind: "player-not-found" }
  | { kind: "internal-error"; message: string };

/** Exactly the variants the mute mutation returns. */
export type MuteResultInput =
  | { kind: "updated" }
  | { kind: "not-subscribed-in-channel" }
  | { kind: "player-not-found" }
  | { kind: "internal-error"; message: string };

/**
 * Shared user-facing messages for the subscription remove/mute mutation
 * results, used by both the Subscriptions tab and the player page. Each helper
 * takes the exact discriminated union its procedure returns and matches it
 * exhaustively, so a new router result kind fails the app typecheck (and
 * `.exhaustive()` throws at runtime) instead of silently becoming
 * "Something went wrong."
 */
export function removeResultOutcome(
  result: RemoveResultInput,
): SubscriptionResultOutcome {
  return match(result)
    .with({ kind: "removed" }, () => ({
      ok: true,
      message: "Subscription removed.",
    }))
    .with({ kind: "player-not-found" }, () => ({
      ok: false,
      message: "Player not found.",
    }))
    .with({ kind: "not-subscribed-in-channel" }, () => ({
      ok: false,
      message: "Player is not subscribed in that channel.",
    }))
    .with({ kind: "internal-error" }, (error) => ({
      ok: false,
      message: error.message,
    }))
    .exhaustive();
}

export function muteResultOutcome(
  result: MuteResultInput,
  isMuted: boolean,
): SubscriptionResultOutcome {
  return match(result)
    .with({ kind: "updated" }, () => ({
      ok: true,
      message: isMuted
        ? "Subscription muted — no more match notifications."
        : "Subscription unmuted.",
    }))
    .with({ kind: "player-not-found" }, () => ({
      ok: false,
      message: "Player not found.",
    }))
    .with({ kind: "not-subscribed-in-channel" }, () => ({
      ok: false,
      message: "Player is not subscribed in that channel.",
    }))
    .with({ kind: "internal-error" }, (error) => ({
      ok: false,
      message: error.message,
    }))
    .exhaustive();
}
