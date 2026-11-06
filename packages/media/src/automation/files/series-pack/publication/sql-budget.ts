import { managedSeriesIdentity } from "#shared/acquisition/library-management.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/**
 * SQL052 independently traverses actual immutable parents. Reserve those reads
 * before dispatch, including repeated trigger queries; never grant SQL a second
 * allowance. Current target/catalog/inventory/CAS checks keep their existing
 * complete scope bound and do not materialize new historical authority.
 */
function policyReads(identity: unknown) {
  const managed = managedSeriesIdentity(identity);
  const approvals =
    managed === null
      ? 0
      : managed.management.schemaVersion === 3
        ? managed.management.approvals.length
        : 1;
  // Actual assessment, current profile, immutable profile version and source;
  // each real approval traverses receipt, plan, approving owner and association.
  return 4 + approvals * 4;
}

export function reserveSeriesPackPublicationSqlV1(
  budget: PublicationAuthorityReadBudget,
  phase:
    "prepare" | "intent" | "physical" | "complete" | "inverse" | "compensated",
  input: {
    identity: unknown;
    batches: number;
    batchIndex?: number;
    forwardBatches?: number;
  },
) {
  const policy = policyReads(input.identity);
  switch (phase) {
    case "prepare":
      budget.consume(policy + 3);
      return;
    case "intent":
      budget.consume(input.batches + policy + 3);
      return;
    case "physical":
      budget.consume(policy + 4 + ((input.batchIndex ?? 0) > 0 ? 1 : 0));
      return;
    case "complete":
      budget.consume(input.batches * 3 + policy + 9);
      return;
    case "inverse":
      budget.consume(3 + ((input.batchIndex ?? 0) > 0 ? 1 : 0));
      return;
    case "compensated":
      budget.consume(7 + 2 * (input.batches + (input.forwardBatches ?? 0)));
      return;
  }
}
