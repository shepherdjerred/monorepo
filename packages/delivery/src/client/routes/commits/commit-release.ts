import { revisionLabel } from "#client/components/identifier.tsx";
import type {
  CarriedFailure,
  CommitVerdict,
} from "#shared/hub/hub-contract.ts";
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
 * Where carried failures shipped: each carrying commit by short sha, the
 * services whose build passed there, and how the release the change ships
 * in stands. "Passed" is that build's CI; a failed release is named rather
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
      return `${sha}, whose ${services.length === 0 ? "build" : `build of ${series(services)}`} passed${releaseClause(entries)}`;
    }),
  );
}

/** One carried failure's release as a short clause for the commit page's build list; "" when nothing needs saying. */
export function carriedReleaseNote(entry: CarriedFailure) {
  const words = releaseWords([entry]);
  return words === null
    ? ""
    : `${words.contradicts ? " but" : " and"} ${words.text}`;
}

/** Why a failed build held nothing back: a later commit's build that includes it passed. */
export function includedNote(carried: readonly CarriedFailure[]) {
  return `Not built on its own; included in ${carriedIn(carried)}`;
}
