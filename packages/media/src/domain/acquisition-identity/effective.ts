import type { ReleaseAttributes } from "#shared/contract.ts";
import type { DefaultAcquisitionIdentity } from "#shared/acquisition/library-management.ts";

/** The caller verifies immutable source evidence and current authority before projecting it. */
export function effectiveCandidate(
  candidate: ReleaseAttributes,
  verifiedIdentity: DefaultAcquisitionIdentity,
): ReleaseAttributes {
  if (candidate.id !== verifiedIdentity.source.releaseId)
    throw new Error("Identity proof belongs to a different release");
  const coverage = verifiedIdentity.coverage;
  const canonical = verifiedIdentity.canonical;
  const allowed =
    canonical.kind === "movie"
      ? [canonical.mediaId]
      : canonical.coordinates.episodes.map((episode) => episode.mediaId);
  if (
    coverage.length === 0 ||
    new Set(coverage).size !== coverage.length ||
    coverage.some((id) => !allowed.includes(id))
  )
    throw new Error("Identity proof has invalid canonical coverage");
  const evidence = candidate.resolvedEvidence;
  return {
    ...candidate,
    mediaIds: [...coverage],
    identityConfidence: "exact",
    ...(evidence === undefined
      ? {}
      : {
          resolvedEvidence: {
            ...evidence,
            release: { ...evidence.release, identityConfirmed: true },
          },
        }),
  };
}
