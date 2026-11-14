import type { MediaRequest } from "#generated/prisma/client.ts";
type ReleasedClaim = Pick<
  MediaRequest,
  | "active"
  | "direct"
  | "excluded"
  | "keepingPolicy"
  | "interestState"
  | "interestReleasedAt"
  | "interestReleaseReason"
>;
type ObservedClaim = ReleasedClaim & {
  userId: string;
  coverageSources: { active: boolean; rootRequest: ReleasedClaim }[];
};
export type ReleasedWatchScope = {
  household: {
    reason: string | null;
    roots: ReleasedClaim[];
    ownerConsent: boolean;
    recipients: { userId: string }[];
  };
  participants: { id: string; restricted: boolean; role: string }[];
  claims: ObservedClaim[];
  cohortClaims: ObservedClaim[];
};

/** Current command-produced release metadata, never a bare watched boolean. */
export function currentReleasedInterest(request: ReleasedClaim, now: Date) {
  if (
    !request.active ||
    !request.direct ||
    request.excluded ||
    request.keepingPolicy !== "temporary" ||
    request.interestReleasedAt === null ||
    request.interestReleasedAt > now
  )
    return false;
  switch (request.interestState) {
    case "expired":
      return request.interestReleaseReason === "lost_interest";
    case "finished":
      return ["watched", "series_finished", "finished_manually"].includes(
        request.interestReleaseReason ?? "",
      );
    case "dropped":
      return request.interestReleaseReason === "dropped_manually";
    case "following":
      return false;
  }
}

/** Called only with the final transaction's locked household, participant and
 * complete physical-cohort claim snapshot. It preserves a warning, not removal
 * authority; current watch/effect guards still protect every physical member. */
export function releasedWatchMayKeepWarning(
  authority: ReleasedWatchScope,
  userId: string,
  now: Date,
) {
  const { household } = authority;
  if (
    household.reason !== null &&
    household.reason !== "requester_playback_renewal_pending"
  )
    return false;
  const user = authority.participants.find((item) => item.id === userId);
  if (user === undefined || user.restricted) return false;
  if (!household.roots.every((root) => currentReleasedInterest(root, now)))
    return false;
  const applicable = (claim: ObservedClaim) => {
    if (!claim.active || claim.excluded) return false;
    if (claim.direct) return currentReleasedInterest(claim, now);
    const sources = claim.coverageSources.filter(
      (source) =>
        source.active &&
        source.rootRequest.active &&
        !source.rootRequest.excluded,
    );
    return (
      sources.length > 0 &&
      sources.every((source) =>
        currentReleasedInterest(source.rootRequest, now),
      )
    );
  };
  return (
    authority.cohortClaims.every((claim) => applicable(claim)) &&
    (authority.claims.some(
      (claim) => claim.userId === userId && applicable(claim),
    ) ||
      (household.ownerConsent &&
        user.role === "owner" &&
        household.recipients.some((recipient) => recipient.userId === userId)))
  );
}
