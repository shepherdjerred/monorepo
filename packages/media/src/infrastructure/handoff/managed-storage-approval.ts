import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  ManagedStorageApprovalEnvelopeSchema,
  type ApprovedStorageRoot,
} from "#shared/canonical-storage.ts";
import { canonicalJson, snapshotHash } from "#migration/profile-import.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export const MANAGED_STORAGE_APPROVAL = "managed_storage_approval_v1";

/** The caller must query this immutable event during its own authority traversal. */
export function managedStorageApproval(
  row: Pick<
    Prisma.ApplicationEventGetPayload<Record<string, never>>,
    "id" | "kind" | "actorId" | "payload" | "dedupeKey"
  >,
) {
  const envelope = ManagedStorageApprovalEnvelopeSchema.parse(row.payload);
  const { approval, approvalHash, raw } = envelope;
  if (
    row.kind !== MANAGED_STORAGE_APPROVAL ||
    row.actorId !== approval.actorId ||
    row.dedupeKey !==
      `managed-storage:${String(approval.recoveryEpoch)}:${String(approval.runtimeVersion)}` ||
    canonicalJson(z.json().parse(approval)) !== raw ||
    snapshotHash(approval) !== approvalHash ||
    approval.mounts.configurationDigest !== snapshotHash(LEGACY_OBSERVER_CONFIG)
  )
    throw new Error("Managed storage owner approval changed");
  return {
    kind: "managed" as const,
    id: row.id,
    planHash: approvalHash,
    approved: true,
    configurationDigest: approval.mounts.configurationDigest,
    mounts: approval.mounts.mounts,
  };
}

export async function assertManagedStorageApprovals(
  db: Pick<Prisma.TransactionClient, "applicationEvent">,
  roots: ApprovedStorageRoot[],
  budget?: PublicationAuthorityReadBudget,
) {
  if (
    new Set(roots.map((root) => root.rootPath)).size !== 2 ||
    roots.some((root) => root.receipt.kind !== "managed")
  )
    throw new Error("Managed storage requires both original owner approvals");
  const rows = await db.applicationEvent.findMany({
    where: {
      id: { in: [...new Set(roots.map((root) => root.receipt.id))] },
      kind: MANAGED_STORAGE_APPROVAL,
    },
  });
  budget?.consume(rows.length);
  const proofs = rows.map((row) => managedStorageApproval(row));
  for (const root of roots) {
    const proof = proofs.find(
      (item) =>
        item.id === root.receipt.id && item.planHash === root.receipt.planHash,
    );
    if (
      proof?.mounts.filter(
        (mount) =>
          mount.root === root.rootPath &&
          mount.pvcUid === root.pvcUid &&
          mount.volumeName === root.volumeName &&
          mount.volumePath === root.volumePath,
      ).length !== 1
    )
      throw new Error("Managed storage owner approval identity changed");
  }
}
