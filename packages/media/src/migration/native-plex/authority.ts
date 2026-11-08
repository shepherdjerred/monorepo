import type { Prisma } from "#generated/prisma/client.ts";
import type { NativePlexProofParent } from "#shared/plex-binding/native.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  lockNativeScope,
  assertNativeSnapshot,
} from "#infrastructure/native-recovery/guards.ts";
import {
  lockNativeQuarantineScope,
  assertNativeQuarantineSnapshot,
} from "#infrastructure/native-quarantine/guards.ts";
import {
  lockNativeArchiveScope,
  assertNativeArchiveSnapshot,
} from "#infrastructure/native-archive/guards.ts";
import {
  lockNativeCompensationScope,
  assertNativeCompensationSnapshot,
} from "#infrastructure/native-compensation/guards.ts";
import type { NativeScope } from "./scope.ts";
import type { NativePlexReviewSnapshot } from "#infrastructure/plex-binding/native/native-parent.ts";

/** Reuse each lifecycle's actual full lock order and reviewed snapshot, never serving ownership. */
export async function lockNativeReview(
  tx: Prisma.TransactionClient,
  parent: NativePlexProofParent,
  scope: NativeScope,
  budget: PublicationAuthorityReadBudget,
): Promise<NativePlexReviewSnapshot> {
  if (parent.purpose !== "native_review")
    throw new Error("Native review lock received execution parent");
  if (scope.schemaVersion === 1 || scope.lifecycleKind === "published") {
    await lockNativeScope(tx, scope);
  } else if (scope.lifecycleKind === "committed_quarantine") {
    await lockNativeQuarantineScope(tx, scope);
  } else if (scope.lifecycleKind === "superseded_archive") {
    await lockNativeArchiveScope(tx, scope);
  } else {
    await lockNativeCompensationScope(tx, scope);
  }
  await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id=${parent.planId} FOR SHARE`;
  const current = await assertReviewSnapshot(tx, parent.planId, scope, budget);
  return { transaction: tx, plan: current.plan, scope: current.scope };
}

function assertReviewSnapshot(
  tx: Prisma.TransactionClient,
  planId: string,
  scope: NativeScope,
  budget: PublicationAuthorityReadBudget,
) {
  if (scope.schemaVersion === 1 || scope.lifecycleKind === "published")
    return assertNativeSnapshot(tx, planId, scope, budget);
  if (scope.lifecycleKind === "committed_quarantine")
    return assertNativeQuarantineSnapshot(tx, planId, scope, budget);
  return scope.lifecycleKind === "superseded_archive"
    ? assertNativeArchiveSnapshot(tx, planId, scope, budget)
    : assertNativeCompensationSnapshot(tx, { planId, scope }, budget);
}
