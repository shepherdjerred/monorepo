import { revisionLabel } from "#client/components/identifier.tsx";
import type {
  CarriedFailure,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
import type { CarriedRelease } from "#shared/hub/commit-release-contract.ts";
import { namedWithMore } from "./commit-blockers.ts";
import { distinct, series } from "./commit-text.ts";

/**
 * How a carrying release stands while it is not live, as the carrying
 * commit's own row says it: singular and plural words, and whether it
 * contradicts "whose build passed" (so it reads "but", not "and"). Most
 * urgent first. A live release adds nothing the row's pill does not say.
 */
const RELEASE_STANDING: [CommitVerdict, string, string, boolean][] = [
  ["recovery_required", "needs recovery", "need recovery", true],
  ["failed", "failed to deploy", "failed to deploy", true],
  ["awaiting_approval", "awaits approval", "await approval", false],
  ["deploying", "is deploying", "are deploying", false],
];

/**
 * How one carried failure's release is named: by its revision, led by its
 * service when several services' releases are in play, since revision
 * numbers restart per service and "r10" alone could be any of them.
 */
function releaseLabel(entry: CarriedFailure, withService: boolean) {
  const revision =
    entry.releaseRevision === undefined
      ? null
      : revisionLabel(entry.releaseRevision);
  const service = withService ? entry.serviceTitle : undefined;
  if (revision === null)
    return service === undefined ? "its release" : `${service}'s release`;
  return service === undefined ? revision : `${service} ${revision}`;
}

/**
 * The standing of the releases that carry a commit's failed builds, said so
 * the carrying commit's row cannot contradict it: "the change ships in
 * release r12, which failed to deploy". Each release keeps its own state:
 * releases are grouped by verdict, most urgent first, never merged under
 * the worst one. Releases with no recorded verdict (none yet) or a live one
 * say nothing. The release can belong to a commit after the carrier, when
 * the carrier composed nothing, so it is named by its own revision.
 */
function releaseWords(entries: readonly CarriedFailure[]) {
  const withService =
    new Set(entries.map((entry) => entry.serviceTitle)).size > 1;
  const parts = RELEASE_STANDING.flatMap(
    ([verdict, one, many, contradicts]) => {
      const labels = distinct(
        entries
          .filter((entry) => entry.releaseVerdict === verdict)
          .map((entry) => releaseLabel(entry, withService)),
      );
      if (labels.length === 0) return [];
      const several = labels.length > 1;
      const bare = withService || labels[0] === "its release";
      const noun = bare ? "" : `${several ? "releases" : "release"} `;
      return [
        {
          contradicts,
          text: `${noun}${series(labels)}, which ${several ? many : one}`,
        },
      ];
    },
  );
  if (parts.length === 0) return null;
  return {
    contradicts: parts.some((part) => part.contradicts),
    text: `the change ships in ${parts.map((part) => part.text).join(", and in ")}`,
  };
}

/** ", but the change ships in release r12, which failed to deploy"; "" when nothing needs saying. */
function releaseClause(entries: readonly CarriedFailure[]) {
  const words = releaseWords(entries);
  return words === null
    ? ""
    : `${words.contradicts ? ", but" : ", and"} ${words.text}`;
}

/**
 * How the commit that carries a failure stands itself, when that is not
 * settled: the carrying commit's own row (its pill) can say it awaits
 * approval or failed, so the note says so beside it instead of leaving
 * "included in X" to look like good news. Most urgent verdict among the
 * carried failures; null when it is deployed, idle or unknown.
 */
const CARRIER_STANDING: [CommitVerdict, string][] = [
  ["recovery_required", "needs recovery"],
  ["failed", "failed to deploy"],
  ["build_failed", "failed CI"],
  ["awaiting_approval", "awaits approval"],
  ["deploying", "is deploying"],
  ["queued", "is queued"],
  ["building", "is still in CI"],
];

function carrierClause(sha: string, entries: readonly CarriedFailure[]) {
  const verdicts = new Set(entries.map((entry) => entry.includedInVerdict));
  const standing = CARRIER_STANDING.find(([verdict]) => verdicts.has(verdict));
  return standing === undefined ? "" : `; ${sha} itself ${standing[1]}`;
}

/**
 * Where carried failures shipped, as a list: each carrying commit by short
 * sha with, in parentheses, the services whose build passed there, how the
 * release the change ships in stands, and how the commit itself stands when
 * it is not settled: "A (whose build of X passed) and B (whose build of Y
 * passed, but the change ships in release r12, which failed to deploy)".
 * "Passed" is that build's CI; a failed release or carrier is named rather
 * than left for the carrying commit's own row to contradict.
 */
export function carriedIn(carried: readonly CarriedFailure[]) {
  const byCommit = new Map<string, CarriedFailure[]>();
  for (const entry of carried) {
    const sha = entry.includedIn.slice(0, 7);
    byCommit.set(sha, [...(byCommit.get(sha) ?? []), entry]);
  }
  return series(
    [...byCommit].map(([sha, entries]) => {
      const services = distinct(
        entries.flatMap((entry) =>
          entry.serviceTitle === undefined ? [] : [entry.serviceTitle],
        ),
      );
      const built =
        services.length === 0 ? "build" : `build of ${series(services)}`;
      return `${sha} (whose ${built} passed${releaseClause(entries)}${carrierClause(sha, entries)})`;
    }),
  );
}

/** One carried failure's release and carrier as a short clause for the commit page's build list; "" when nothing needs saying. */
export function carriedReleaseNote(entry: CarriedFailure) {
  const words = releaseWords([entry]);
  return `${
    words === null ? "" : `${words.contradicts ? " but" : " and"} ${words.text}`
  }${carrierClause(entry.includedIn.slice(0, 7), [entry])}`;
}

/** Why a failed build held nothing back: a later commit's build that includes it passed. */
export function includedNote(carried: readonly CarriedFailure[]) {
  return `Not built on its own; included in ${carriedIn(carried)}`;
}

/** How a landed release is worded, singular and plural. */
const LANDED: Record<CarriedRelease["state"], [string, string]> = {
  live: ["is live", "are live"],
  superseded: [
    "was superseded by a newer release, which is deployed",
    "were superseded by newer releases, which are deployed",
  ],
};

/**
 * The releases that ship a failed pipeline's change and have landed: live,
 * or superseded by a newer release that is deployed (r346 failed, was
 * canceled or was replaced; the change is live through the newer one). The releases still
 * held back are named by the row's blocker notes, so they are not here.
 * "Releases in f545a3b: 3 were superseded by newer releases, which are
 * deployed (Streambot & media r346, Golink r12, Hub r278), Cluster
 * observability baseline r75 is live". Null when none have landed.
 */
export function releasesNote(
  releases: readonly CarriedRelease[] | undefined,
): string | null {
  if (releases === undefined || releases.length === 0) return null;
  const shas = distinct(
    releases.map((release) => release.includedIn.slice(0, 7)),
  );
  const parts = (["superseded", "live"] as const).flatMap((state) => {
    const names = releases
      .filter((release) => release.state === state)
      .map(
        (release) => `${release.service} ${revisionLabel(release.revision)}`,
      );
    const [only] = names;
    const [one, many] = LANDED[state];
    if (only === undefined) return [];
    return names.length === 1
      ? [`${only} ${one}`]
      : [`${String(names.length)} ${many} (${namedWithMore(names)})`];
  });
  return `Releases in ${series(shas)}: ${parts.join(", ")}`;
}
