import type { Carrier } from "./carried.ts";
import type {
  CarriedFailure,
  CommitBuild,
  CommitService,
  CommitStatus,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
import type { CarriedRelease } from "#shared/hub/commit-release-contract.ts";

/**
 * A failed build and the later commit that carries it, with how the release
 * its change ships in stands: the verdict its row shows on the carrying
 * commit, and its revision when a set was composed.
 */
export function carriedFailure(
  build: CommitBuild,
  carrier: Carrier,
  release: CommitService | undefined,
): CarriedFailure {
  return {
    buildId: build.id,
    includedIn: carrier.includedIn,
    ...(build.serviceTitle === undefined
      ? {}
      : { serviceTitle: build.serviceTitle }),
    ...(release === undefined ? {} : { releaseVerdict: release.verdict }),
    ...(release?.versionSet == null
      ? {}
      : { releaseRevision: release.versionSet.revision }),
  };
}

/**
 * The releases that ship a failed pipeline's change and have landed, one per
 * service: live or superseded by a newer accepted release in every
 * environment they reached. A release still held back is named by the
 * commit's blockers, and one with no version set (a platform change) has no
 * revision to name. The field is absent when there are none.
 */
export function withCarriedReleases(entries: readonly CommitService[]): {
  carriedReleases?: CarriedRelease[];
} {
  const releases = entries.flatMap((entry): CarriedRelease[] => {
    const { versionSet, includedIn, environments } = entry;
    const landed =
      environments.length > 0 &&
      environments.every(
        (environment) =>
          environment.state === "live" || environment.state === "superseded",
      );
    if (!landed || versionSet === null || includedIn === undefined) return [];
    return [
      {
        service: entry.service.title,
        revision: versionSet.revision,
        includedIn,
        state: environments.every((environment) => environment.state === "live")
          ? "live"
          : "superseded",
      },
    ];
  });
  return releases.length === 0 ? {} : { carriedReleases: releases };
}

/** The shas of the commits that carry a commit's failed builds. */
export function carrierCommitShas(statuses: readonly CommitStatus[]) {
  return statuses.flatMap((status) =>
    (status.carriedFailures ?? []).map((entry) => entry.includedIn),
  );
}

/**
 * Each carried failure with the carrying commit's own verdict, so a row can
 * say that the commit that carries it awaits approval or failed. A carrier
 * the read does not know leaves the failure as it was.
 */
export function withCarrierVerdicts(
  status: CommitStatus,
  verdicts: ReadonlyMap<string, CommitVerdict>,
): CommitStatus {
  if (status.carriedFailures === undefined) return status;
  return {
    ...status,
    carriedFailures: status.carriedFailures.map((entry) => {
      const verdict = verdicts.get(entry.includedIn);
      return verdict === undefined
        ? entry
        : { ...entry, includedInVerdict: verdict };
    }),
  };
}
