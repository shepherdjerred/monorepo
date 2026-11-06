import type {
  MovieHistoryScopeV3,
  MovieHistoryStoredResponseV3,
} from "#shared/movie-editions/history-review-v3.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Actual rows already queried by this transaction, never a persisted allowance or a new budget. */
export type MovieHistorySqlReadsV3 = {
  records: number;
  scopedReceipts: number;
  defaultReceipts: number;
  publicationParents: number;
};

/** Admit the SQL053 immutable reads BEFORE the corresponding writes enqueue deferred guards. */
export function reserveMovieHistorySqlV3(
  budget: PublicationAuthorityReadBudget,
  input: {
    phase: "prepare" | "respond" | "release";
    scope: MovieHistoryScopeV3;
    reads: MovieHistorySqlReadsV3;
    responses: Pick<MovieHistoryStoredResponseV3, "declaration">[];
  },
) {
  const { scope, reads } = input;
  // Scope validation: association+video+coverage, the caption completeness count plus each exact row, and current choices.
  const physical =
    3 +
    2 * scope.asset.subtitles.length +
    2 * scope.asset.subtitleHistory.length +
    scope.choices.length;
  // Each shown claim reads its capture, record, binding and actual latest binding. Completeness reads each record+capture.
  // A prior scoped ledger joins receipt+review and its canonical event; historical default has two parents.
  const claims =
    4 * scope.legacyClaims.length +
    2 * reads.records +
    reads.records * (3 * reads.scopedReceipts + 2 * reads.defaultReceipts) +
    2 * reads.records * scope.excludedPairs.length;
  const positive = input.responses.filter(
    (row) => row.declaration.intent !== "no_longer_request",
  ).length;
  if (input.phase === "prepare") {
    // Review+canonical event; initial receipt+plan; actual initial-library review+manifest; publication leaf.
    budget.consume(3 + physical + 4 + reads.publicationParents + claims);
  } else if (input.phase === "respond") {
    budget.consume(3 + physical + claims + positive);
  } else {
    // Review, receipt, canonical event, operation+outbox; canonical capture event; two literal response reads.
    // Same-TX receipt/event/operation/outbox checks are separate reads. Hold and terminal-review guards reread parents.
    budget.consume(
      6 + physical + claims + 2 * input.responses.length + positive + 4 + 2 + 1,
    );
  }
}
