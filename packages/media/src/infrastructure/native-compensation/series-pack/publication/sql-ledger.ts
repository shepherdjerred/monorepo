import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** The command/verified-serving trigger queries receipt, plan, command, owner.
 * Keep a conservative fifth parent for the independent actual row projection.
 * Final deferred serving validation repeats those four immutable parents.
 */
export function reserveSeriesPackNativePublicationSqlV1(
  budget: PublicationAuthorityReadBudget,
  phase: "queue" | "commit",
) {
  budget.consume(phase === "queue" ? 5 : 9);
}
