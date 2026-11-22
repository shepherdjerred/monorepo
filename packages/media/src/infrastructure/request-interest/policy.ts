import { MediaError } from "#application/errors.ts";
import { LIBRARY_KEEPING_NAMES } from "#shared/household/names.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaRequest } from "#generated/prisma/client.ts";

/** Only a native completed cycle starts a rewatch. Personal stops and unfinished
 * renewals retain their cycle's credit, including a partially completed rewatch. */
export function renewedCompletionFence(
  prior: Pick<
    MediaRequest,
    "interestReleaseReason" | "completionRequiredAfter"
  > | null,
  now: Date,
) {
  return prior !== null &&
    ["watched", "series_finished"].includes(prior.interestReleaseReason ?? "")
    ? { completionRequiredAfter: now }
    : {};
}

export function requestKeepingPolicy(
  actor: MediaActor,
  requested: "keep" | "temporary" | undefined,
  prior?: {
    active: boolean;
    interestState: string;
    keepingPolicy: "keep" | "temporary";
  } | null,
): "keep" | "temporary" {
  if (actor.role !== "owner" || actor.restricted) {
    if (requested === "keep")
      throw new MediaError(
        "owner_required",
        "Only the owner can keep a title for good",
        403,
      );
    // Repeating a member request cannot revoke a permanent Keep granted by
    // the owner. Only an owner policy command can change that protection.
    return prior?.active === true && prior.keepingPolicy === "keep"
      ? "keep"
      : "temporary";
  }
  if (requested !== undefined) return requested;
  if (prior?.active === true && prior.interestState === "following")
    return prior.keepingPolicy;
  throw new MediaError(
    "keeping_policy_required",
    `Choose ${LIBRARY_KEEPING_NAMES.keep} or ${LIBRARY_KEEPING_NAMES.temporary} for this request`,
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

/** Cancellation withdraws acquisition consent, not a prior owner's permanent Keep. */
export function preservedClaimKeep(
  request: {
    keepingPolicy: "keep" | "temporary";
  },
  cancelling = true,
) {
  return cancelling && request.keepingPolicy === "keep"
    ? {
        libraryKeep: true,
        libraryPolicyExplicit: true,
        libraryPolicyActorId: null,
      }
    : {};
}
