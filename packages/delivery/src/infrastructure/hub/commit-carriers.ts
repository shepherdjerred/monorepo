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
 * environment they reached, with how their own deployments ended. A release still held back is named by the
 * commit's blockers, and one with no version set (a platform change) has no
 * revision to name. The field is absent when there are none.
 */
export function withCarriedReleases(entries: readonly CommitService[]): {
  carriedReleases?: CarriedRelease[];
} {
  const releases = new Map<string, CarriedRelease>();
  for (const entry of entries) {
    const { versionSet, includedIn, environments } = entry;
    const landed =
      environments.length > 0 &&
      environments.every(
        (environment) =>
          environment.state === "live" || environment.state === "superseded",
      );
    if (!landed || versionSet === null || includedIn === undefined) continue;
    // The release's own deployments, not the state: a release live in one
    // environment is live even where a newer one superseded it elsewhere, and
    // a failed or canceled deployment is named even when it was superseded.
    const statuses = new Set(
      environments.map((environment) => environment.release?.status),
    );
    const outcome = statuses.has("failed")
      ? ("failed" as const)
      : statuses.has("canceled")
        ? ("canceled" as const)
        : undefined;
    releases.set(`${entry.service.id}/${String(versionSet.revision)}`, {
      service: entry.service.title,
      revision: versionSet.revision,
      includedIn,
      state: environments.some((environment) => environment.state === "live")
        ? "live"
        : "superseded",
      ...(outcome === undefined ? {} : { outcome }),
    });
  }
  return releases.size === 0 ? {} : { carriedReleases: [...releases.values()] };
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
