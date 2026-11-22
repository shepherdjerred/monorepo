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
 * The state of the releases that carry a commit's failed builds, said so
 * the carrying commit's row cannot contradict it: "the change ships in
 * release r12, which failed to deploy". The most urgent state of any of the
 * releases decides; releases with no recorded verdict (none yet) say
 * nothing. The release can belong to a commit after the carrier, when the
 * carrier composed nothing, so it is named by its own revision.
 */
function releaseWords(entries: readonly CarriedFailure[]) {
  const verdicts = new Set(
    entries.flatMap((entry) =>
      entry.releaseVerdict === undefined ? [] : [entry.releaseVerdict],
    ),
  );
  const standing = RELEASE_STANDING.find(([verdict]) => verdicts.has(verdict));
  if (standing === undefined) return null;
  const [, one, many, contradicts] = standing;
  const revisions = distinct(
    entries.flatMap((entry) =>
      entry.releaseRevision === undefined
        ? []
        : [revisionLabel(entry.releaseRevision)],
    ),
  );
  const several = revisions.length > 1;
  const noun =
    revisions.length === 0
      ? "its release"
      : `${several ? "releases" : "release"} ${series(revisions)}`;
  return {
    contradicts,
    text: `the change ships in ${noun}, which ${several ? many : one}`,
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
