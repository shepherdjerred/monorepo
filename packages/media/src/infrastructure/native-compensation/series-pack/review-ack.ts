import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type {
  SeriesPackNativeReviewV1,
  SeriesPackNativeApplyV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import { SeriesPackNativeFinishedV4Schema } from "#shared/native-recovery/series-pack/evidence.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readSeriesPackNativeCoreRecordV1 } from "./records.ts";
import { loadSeriesPackNativePlexV1 } from "./plex-records.ts";

/** Only real immutable terminal output is ACKed. This grants no new owner,
 * Files or Network permission and never recaptures an old observation clock. */
export async function readSeriesPackNativeReviewAckV1(
  tx: Prisma.TransactionClient,
  input: SeriesPackNativeReviewV1 | SeriesPackNativeApplyV1,
  budget: PublicationAuthorityReadBudget,
  kind: "prepare" | "apply" | "observe" = "observe",
) {
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: input.planId },
  });
  budget.consume(1);
  if (plan.state === "applied") {
    const record = await readSeriesPackNativeCoreRecordV1(tx, plan.id, budget);
    const matched =
      (kind !== "apply" &&
        record.approved.row.operationId === input.operationId) ||
      (kind !== "prepare" &&
        record.applied.row.operationId === input.operationId);
    if (
      !matched ||
      ("planHash" in input && record.row.receipt.planHash !== input.planHash)
    )
      throw new Error(
        "Native pack completed review ACK has another literal actual command",
      );
    return true;
  }
  if (plan.state !== "awaiting_review" || "planHash" in input) return false;
  const finished = SeriesPackNativeFinishedV4Schema.parse(plan.plan);
  if (finished.plex.parent.operationId !== input.operationId) return false;
  if (identityHash(plan.plan) !== plan.planHash)
    throw new Error("Native pack completed preparation hash changed");
  const proof = await loadSeriesPackNativePlexV1(tx, finished.plex, {
    transaction: tx,
    budget,
    plan,
  });
  if (proof.row.operation.kind !== "prepare_series_pack_native_compensation_v1")
    throw new Error(
      "Native pack preparation ACK is not its real prepare command",
    );
  return true;
}
