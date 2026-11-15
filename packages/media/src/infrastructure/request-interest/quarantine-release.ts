import type { MediaRequest } from "#generated/prisma/client.ts";
import { hasFollowingRequestInterest } from "#infrastructure/request-claims.ts";
import { currentReleasedInterest } from "#automation/plex-events/released-interest.ts";

type ReleasedRequest = Pick<
  MediaRequest,
  | "userId"
  | "active"
  | "direct"
  | "excluded"
  | "keepingPolicy"
  | "interestState"
  | "interestReleasedAt"
  | "interestReleaseReason"
>;
type Claim = ReleasedRequest & {
  coverageSources: readonly { active: boolean; rootRequest: ReleasedRequest }[];
};
export type QuarantineReleaseScope = {
  participants: readonly { id: string; restricted: boolean; role: string }[];
  household: {
    roots: readonly ReleasedRequest[];
    ownerConsent: boolean;
    recipients: readonly { userId: string }[];
    reason: string | null;
    libraryKeep: boolean;
  };
  claims: readonly Claim[];
  cohortClaims: readonly Claim[];
};

export function finalQuarantineRelease(request: ReleasedRequest, now: Date) {
  // Plex unwatch is observation, not renewed viewing consent. Automatic
  // completion stays released until Keep watching or Request again.
  return currentReleasedInterest(request, now);
}

/** Suppresses only this viewer's restore demand. Full physical-cohort removal
 * guards still decide Keep, other followers, unknown watch, ownership and purge. */
export function quarantinedReleaseObservationOnly(
  authority: QuarantineReleaseScope,
  userId: string,
  now: Date,
) {
  const user = authority.participants.find((value) => value.id === userId);
  if (user === undefined || user.restricted) return false;
  if (
    authority.household.roots.length === 0 &&
    authority.household.ownerConsent &&
    authority.household.reason === null &&
    !authority.household.libraryKeep &&
    user.role === "owner" &&
    authority.household.recipients.some(
      (recipient) => recipient.userId === userId,
    ) &&
    !authority.cohortClaims.some((claim) => claim.userId === userId) &&
    !authority.cohortClaims.some(
      (claim) =>
        hasFollowingRequestInterest(claim) ||
        (claim.active && !claim.excluded && claim.keepingPolicy === "keep"),
    )
  )
    return true;
  const roots = authority.household.roots.filter(
    (root) => root.userId === userId,
  );
  const claims = authority.claims.filter((claim) => claim.userId === userId);
  const cohort = authority.cohortClaims.filter(
    (claim) => claim.userId === userId,
  );
  if (
    cohort.some((claim) => hasFollowingRequestInterest(claim)) ||
    roots.some((root) =>
      hasFollowingRequestInterest({ ...root, coverageSources: [] }),
    )
  )
    return false;
  const allClaims = [...claims, ...cohort];
  const intentions = [
    ...roots,
    ...allClaims.filter((claim) => claim.direct),
    ...allClaims.flatMap((claim) =>
      claim.coverageSources
        .filter((source) => source.active)
        .map((source) => source.rootRequest),
    ),
  ];
  return (
    intentions.length > 0 &&
    intentions.every((request) => finalQuarantineRelease(request, now))
  );
}
