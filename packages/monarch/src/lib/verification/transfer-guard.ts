import type { MonarchCategory } from "../monarch/types.ts";
import type { ProposedChange } from "../classifier/types.ts";
import { log } from "../logger.ts";

// Moving a transaction between category-group types (transfer <-> expense or
// income) changes what it *is*, not how it's labeled: a credit-card payment
// reclassified as spending double-counts the purchase, and real spending
// reclassified as a transfer vanishes from budgets. The classifier has no
// reliable signal for that distinction (a bill payment to Apple looks like an
// Apple purchase), so cross-group proposals are demoted to review flags
// instead of being auto-applied. "Uncategorized" is exempt: it is the
// catch-all and its group type carries no meaning.
export function guardCrossGroupChanges(
  changes: ProposedChange[],
  categories: MonarchCategory[],
): { changes: ProposedChange[]; demoted: number } {
  const groupTypeById = new Map(categories.map((c) => [c.id, c.group.type]));
  const uncategorized = new Set(
    categories.filter((c) => c.name === "Uncategorized").map((c) => c.id),
  );

  let demoted = 0;
  const guarded = changes.map((change) => {
    if (change.type === "flag") return change;
    if (uncategorized.has(change.currentCategoryId)) return change;

    const fromType = groupTypeById.get(change.currentCategoryId);
    if (fromType === undefined) return change;

    const targetIds =
      change.type === "split"
        ? (change.splits ?? []).map((s) => s.categoryId)
        : [change.proposedCategoryId];
    const crossesGroup = targetIds.some((id) => {
      const toType = groupTypeById.get(id);
      return toType !== undefined && toType !== fromType;
    });
    if (!crossesGroup) return change;

    demoted++;
    return {
      ...change,
      type: "flag" as const,
      reason: `Cross-group change (${fromType} → other) needs human review: proposed ${change.proposedCategory}${change.reason === undefined ? "" : `; ${change.reason}`}`,
    };
  });

  if (demoted > 0) {
    log.info(
      `Transfer guard: demoted ${String(demoted)} cross-group changes to review flags`,
    );
  }
  return { changes: guarded, demoted };
}
