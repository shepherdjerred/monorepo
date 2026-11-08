import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import type { PlexBindingExpected } from "#shared/plex-binding/expected.ts";
import type { MovieReplacementSnapshotV2 } from "#shared/movie-editions/subtitle-replacement-v2.ts";

/** The new SQL dispatches load one exact rollback Operation per generic video
 * parent, plus two actual reads for a rollback video-baseline caption source. */
export function reserveMovieRollbackCaptionSqlV1(
  budget: PublicationAuthorityReadBudget,
  snapshot: MovieReplacementSnapshotV2,
  phase: "capture" | "settlement",
) {
  if (snapshot.publication.kind !== "movie_rollback_publication_v1") return;
  budget.consume(
    (phase === "capture" ? 1 : 0) +
      (snapshot.source.kind === "video_baseline" ? 2 : 0),
  );
}

function consentParents(version: 2 | 3) {
  // Personal: request, choice, actor, subject and mapping. Managed: actual
  // handoff receipt, applied plan, owner and current target.
  return version === 2 ? 5 : 4;
}

function captionRows(intent: MovieRollbackIntentV1) {
  return (
    intent.predecessor.subtitles.length +
    intent.predecessor.subtitleHistory.length +
    intent.successor.subtitles.length +
    intent.successor.subtitleHistory.length
  );
}

export function reserveMoviePlexRejectionSqlV1(
  budget: PublicationAuthorityReadBudget,
  version: 2 | 3,
  expected: PlexBindingExpected,
) {
  // Command, AA, publication, target, runtime, writer, profile, reservation,
  // successor and media; exact coverage, pointer and previous evidence.
  const previous = expected.previous[0];
  const group = expected.newGroups[0];
  if (
    previous === undefined ||
    group === undefined ||
    expected.previous.length !== 1 ||
    expected.newGroups.length !== 1
  )
    throw new Error("Movie rejection SQL reservation lost its exact scope");
  budget.consume(
    10 +
      group.coverage.length +
      1 +
      (previous.evidence === null ? 0 : 1) +
      consentParents(version),
  );
}

export function reserveMovieRollbackIntentSqlV1(
  budget: PublicationAuthorityReadBudget,
  version: 2 | 3,
  intent: MovieRollbackIntentV1,
) {
  // AA, publication, target, runtime, reservation, pointer, original evidence,
  // profile and actual rejection event; both assets/coverage and every caption.
  budget.consume(9 + 4 + captionRows(intent) + consentParents(version));
}

export function reserveMovieRollbackPhysicalSqlV1(
  budget: PublicationAuthorityReadBudget,
  version: 2 | 3,
  intent: MovieRollbackIntentV1,
  preflightFinalSnapshots = false,
) {
  // Deferred birth: AA, target, runtime, pointer, profile, two assets and
  // coverage plus the complete caption union. Each actual mutation also has
  // one narrow pending-fence Operation parent: two assets, two coverages,
  // each sidecar path update, and every advanced owned caption.
  const sidecars =
    intent.source.reference.intent.entries[0].entry.previousSidecars.length;
  const fences = 2 + 2 + sidecars + intent.predecessor.subtitles.length;
  const sql = 5 + 4 + captionRows(intent) + consentParents(version) + fences;
  if (preflightFinalSnapshots) {
    const finalRows =
      5 + captionRows(intent) + intent.predecessor.subtitles.length;
    if (budget.take - 1 < sql + finalRows) budget.consume(sql + finalRows);
  }
  budget.consume(sql);
}

export function reserveMovieRollbackPlexSqlV1(
  budget: PublicationAuthorityReadBudget,
  version: 2 | 3,
  intent: MovieRollbackIntentV1,
) {
  // AA, target, runtime, writer, media, pointer, original/new evidence, profile
  // and complete group/member/item/part/path; both exact assets/coverage and
  // complete captions. No asset/caption mutation occurs in this phase.
  budget.consume(14 + 4 + captionRows(intent) + consentParents(version));
}
