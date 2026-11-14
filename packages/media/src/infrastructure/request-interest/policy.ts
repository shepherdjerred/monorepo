import { MediaError } from "#application/errors.ts";
import type { MediaActor } from "#application/auth.ts";

export function requestKeepingPolicy(
  actor: MediaActor,
  requested: "keep" | "temporary" | undefined,
  prior?: {
    active: boolean;
    interestState: string;
    keepingPolicy: "keep" | "temporary";
  } | null,
): "keep" | "temporary" {
  if (actor.role !== "owner") {
    if (requested === "keep")
      throw new MediaError(
        "owner_required",
        "Only the owner can keep media indefinitely",
        403,
      );
    return "temporary";
  }
  if (requested !== undefined) return requested;
  if (prior?.active === true && prior.interestState === "following")
    return prior.keepingPolicy;
  throw new MediaError(
    "keeping_policy_required",
    "Choose Keep indefinitely or Temporary for this request",
    422,
  );
}

export function renewedInterest(now: Date) {
  return {
    interestState: "following" as const,
    interestRenewedAt: now,
    usableUnwatchedSince: null,
    interestNoticeEventId: null,
    interestNoticeRevision: null,
    interestNoticeAcceptedAt: null,
    interestNoticeViewedAt: null,
    interestReleasedAt: null,
    interestReleaseReason: null,
  };
}
