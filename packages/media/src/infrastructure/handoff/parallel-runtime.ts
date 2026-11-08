import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { readRuntimeProof, RuntimeProofError } from "./runtime-proof.ts";
import {
  CanonicalMountEvidenceSchema,
  ManagedStorageApprovalSchema,
} from "#shared/canonical-storage.ts";
import { canonicalJson, snapshotHash } from "#migration/profile-import.ts";
import { MANAGED_STORAGE_APPROVAL } from "./managed-storage-approval.ts";

/** Caller owns the authenticated idempotent command transaction. */
export async function setManagedRuntime(
  tx: Prisma.TransactionClient,
  input: { mode: "active" | "observe"; expectedVersion: number },
  actorId: string,
) {
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR UPDATE`;
  const current = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (current.version !== input.expectedVersion)
    throw new MediaError(
      "runtime_changed",
      "Refresh the runtime before changing it",
      409,
    );
  if (input.mode === "active") {
    // Legacy ownership can only be installed by its existing reviewed handoff.
    if ((await tx.mediaHandoffReceipt.count()) !== 0)
      throw new MediaError(
        "runtime_handoff_required",
        "Use the existing library handoff to activate adopted files",
        409,
      );
    let proof;
    try {
      proof = await readRuntimeProof(tx);
    } catch (error) {
      if (!(error instanceof RuntimeProofError)) throw error;
      throw new MediaError(
        "runtime_storage_unavailable",
        "Await a fresh observation of the Media file worker storage",
        409,
      );
    }
    if (proof.kind !== "canonical_storage")
      throw new MediaError(
        "runtime_storage_unavailable",
        "Await a fresh observation of the Media file worker storage",
        409,
      );
  }
  const updated = await tx.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: {
      mode: input.mode,
      ownershipConfirmed: input.mode === "active",
      version: { increment: 1 },
    },
  });
  if (input.mode === "active") {
    const rows = await tx.mediaStorageAuthority.findMany({
      orderBy: { rootPath: "asc" },
    });
    // Restored storage keeps its original approval; restarting never replaces it.
    if (
      rows.every(
        (row) => CanonicalMountEvidenceSchema.safeParse(row.evidence).success,
      )
    ) {
      const approval = ManagedStorageApprovalSchema.parse({
        schemaVersion: 1,
        actorId,
        recoveryEpoch: updated.recoveryEpoch,
        runtimeVersion: updated.version,
        mounts: CanonicalMountEvidenceSchema.parse(rows[0]?.evidence),
      });
      await tx.applicationEvent.create({
        data: {
          actorId,
          kind: MANAGED_STORAGE_APPROVAL,
          dedupeKey: `managed-storage:${String(updated.recoveryEpoch)}:${String(updated.version)}`,
          payload: {
            approval,
            raw: canonicalJson(approval),
            approvalHash: snapshotHash(approval),
          },
        },
      });
    }
  }
  return updated;
}
