import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";

function captionCount(intent: MovieRollbackIntentV1) {
  return (
    intent.predecessor.subtitles.length +
    intent.predecessor.subtitleHistory.length +
    intent.successor.subtitles.length +
    intent.successor.subtitleHistory.length
  );
}

export function reserveRequestedMovieRollbackIntentSqlV1(
  budget: PublicationAuthorityReadBudget,
  intent: MovieRollbackIntentV1,
) {
  // AA, publication, source command, target, runtime, pointer, B evidence,
  // original A evidence, profile, cleanup and playback; actual A/B+coverage;
  // current owner+mapping, exact B video grant, cleanup's pending-intent fence.
  const captions = intent.captionManifest;
  if (captions === undefined)
    throw new Error("Manual admission budget lost its exact caption parents");
  const sourceParents = captions.captions.reduce(
    (count, caption) =>
      count +
      (caption.parent.source.kind === "installation_v4"
        ? 1
        : caption.parent.source.kind === "replacement_v2"
          ? 3
          : 0),
    0,
  );
  budget.consume(13 + 4 + captionCount(intent) + 2 + 1 + sourceParents);
}

export function reserveRequestedMovieRollbackPhysicalSqlV1(
  budget: PublicationAuthorityReadBudget,
  intent: MovieRollbackIntentV1,
) {
  const sidecars =
    intent.source.reference.intent.entries[0].entry.previousSidecars.length;
  const successorSidecars = intent.captionManifest?.captions.length;
  if (successorSidecars === undefined)
    throw new Error("Manual physical budget lost its actual caption manifest");
  const fences =
    4 +
    sidecars +
    intent.predecessor.subtitles.length +
    successorSidecars +
    intent.successor.subtitles.length;
  const sql = 6 + 4 + captionCount(intent) + 2 + 1 + 1 + fences;
  // Both actual final snapshots also requery their complete caption inventory
  // and owned active rows. Reject an insufficient original allowance BEFORE IO;
  // successful calls debit those queries normally when they actually return.
  const finalSnapshots =
    5 + captionCount(intent) + intent.predecessor.subtitles.length;
  if (budget.take - 1 < sql + finalSnapshots)
    budget.consume(sql + finalSnapshots);
  budget.consume(sql);
}

export function reserveRequestedMovieRollbackPlexSqlV1(
  budget: PublicationAuthorityReadBudget,
  intent: MovieRollbackIntentV1,
) {
  // Exact original automatic serving-closure rows, plus current owner+mapping;
  // the old request/choice/handoff consent is never used for this protocol.
  budget.consume(14 + 4 + captionCount(intent) + 2);
}
