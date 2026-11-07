import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { SeriesPackNativeCompensationScopeV3 } from "#shared/native-recovery/series-pack/scope.ts";

/** SQL independently resolves real immutable parents. Reserve every actual
 * traversal before calling SQL; never create a database-side second allowance.
 * Complete-ledger native spies must confirm these counts before admission is
 * claimed. Current whole inventory equality/CAS remains separately bounded.
 */
export function reserveSeriesPackNativeSqlV1(
  budget: PublicationAuthorityReadBudget,
  scope: SeriesPackNativeCompensationScopeV3,
  phase: "batch" | "finish_review" | "approve" | "begin" | "complete",
) {
  const originals =
    3 +
    scope.publication.intent.seriesPackPublication.preparations.length +
    scope.forwardParents.length;
  const storageParents =
    new Set(scope.storageRoots.map((root) => JSON.stringify(root.receipt)))
      .size * 2;
  switch (phase) {
    // Includes the unchanged generic native_plex_parent trigger's three
    // independent plan/observation reads as well as the six new-gate reads.
    case "batch":
      budget.consume(originals + 10);
      return;
    case "finish_review":
      budget.consume(originals + 7);
      return;
    case "approve":
      budget.consume(originals + 14 + storageParents);
      return;
    case "begin":
      budget.consume(7);
      return;
    // The independently deferred guard re-reads continuation/receipt/plan/owner
    // and its actual four-row execution proof at COMMIT (eight more parents).
    case "complete":
      budget.consume(originals + 27 + storageParents);
      return;
  }
}
