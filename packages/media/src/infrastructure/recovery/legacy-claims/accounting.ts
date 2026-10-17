import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  RecoveryClaimAccountingSchema,
  RecoveryClaimAcknowledgementSchema,
  RecoveryClaimIdentitySchema,
  type RecoveryClaimProjection,
} from "#shared/recovery-claims.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { claimConflict } from "./bindings.ts";

export function requiredClaimAcknowledgements(
  claims: RecoveryClaimProjection[],
  userId: string,
) {
  return claims
    .filter((claim) => claim.userId === userId)
    .map((claim) => RecoveryClaimAcknowledgementSchema.strip().parse(claim))
    .sort((a, b) =>
      `${a.captureHash}:${a.provenanceKey}`.localeCompare(
        `${b.captureHash}:${b.provenanceKey}`,
      ),
    );
}
export function claimAccounting(claims: RecoveryClaimProjection[]) {
  return claims.map((claim) =>
    RecoveryClaimAccountingSchema.strip().parse(claim),
  );
}
export function claimIdentityHash(claim: unknown) {
  return snapshotHash(RecoveryClaimIdentitySchema.strip().parse(claim));
}
export async function accountedRecoveryClaims(
  db: Prisma.TransactionClient,
  mediaIds: string[],
) {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const receipts = await db.recoveryReleaseReceipt.findMany({
    where: {
      recoveryEpoch: runtime.recoveryEpoch,
      OR: mediaIds.map((id) => ({
        claimAccounting: { array_contains: [{ mediaIds: [id] }] },
      })),
    },
    orderBy: { id: "asc" },
    take: 1001,
  });
  if (receipts.length > 1000)
    throw claimConflict(
      "Legacy claim receipt history exceeds bounded reconciliation",
    );
  const entries = receipts.flatMap((receipt) =>
    receipt.claimAccounting === null
      ? []
      : z
          .array(RecoveryClaimAccountingSchema)
          .max(1000)
          .parse(receipt.claimAccounting),
  );
  const accounted = new Map<string, Set<string>>();
  for (const entry of entries) {
    const key = claimIdentityHash(entry);
    const accountedIds = accounted.get(key) ?? new Set<string>();
    for (const id of entry.mediaIds) accountedIds.add(id);
    accounted.set(key, accountedIds);
  }
  return accounted;
}
