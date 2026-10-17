import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { PriorNativeBinding } from "#shared/native-recovery/archive.ts";
import { NativeRecoveryFileEvidenceSchema } from "#shared/native-recovery.ts";
import {
  NativeStoredScopeSchema,
  FinishedNativeV2Schema,
} from "#shared/native-recovery/lifecycle.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { nativePhysicalIdentity } from "./physical-identity.ts";

/** Immutable dependencies of an already validated native grant, never new effect authority. */
export async function nativeGrantSettlements(
  tx: Prisma.TransactionClient,
  reference: PriorNativeBinding,
  budget: PublicationAuthorityReadBudget,
) {
  budget.consume(1);
  const row = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: reference.receiptId },
    include: { plan: true },
  });
  const scope = NativeStoredScopeSchema.parse(row.plan.scope);
  if (scope.schemaVersion === 1) return [];
  const finished = FinishedNativeV2Schema.parse(row.plan.plan);
  const selection = z
    .object({
      scope: z.json(),
      fileEvidence: z.object({ files: z.array(z.json()) }).catchall(z.json()),
      networkEvidence: z.json(),
      bindings: z.array(z.json()),
    })
    .parse(row.selection);
  const bindings = selection.bindings.filter(
    (raw) =>
      z.object({ assetId: z.uuid() }).parse(raw).assetId === reference.assetId,
  );
  const evidence = selection.fileEvidence.files
    .map((raw) =>
      NativeRecoveryFileEvidenceSchema.shape.files.element.parse(raw),
    )
    .filter((file) => file.assetId === reference.assetId);
  if (
    row.plan.state !== "applied" ||
    row.plan.planHash !== row.planHash ||
    row.planHash !== reference.planHash ||
    row.plan.recoveryEpoch !== row.recoveryEpoch ||
    scope.lifecycleKind !== reference.receiptLifecycle ||
    snapshotHash(nativeJson(row.plan.plan)) !== row.planHash ||
    snapshotHash(nativeJson(row.plan.scope)) !== finished.scopeHash ||
    snapshotHash(selection.scope) !== finished.scopeHash ||
    snapshotHash(nativeJson(selection.fileEvidence)) !==
      snapshotHash(finished.files) ||
    snapshotHash(selection.networkEvidence) !==
      snapshotHash(finished.network) ||
    bindings.length !== 1 ||
    snapshotHash(z.json().parse(bindings[0])) !== reference.bindingHash ||
    evidence.length !== 1 ||
    snapshotHash(nativePhysicalIdentity(evidence[0])) !==
      reference.physicalEvidenceHash
  )
    throw new Error("Archive native settlement parent changed");
  return scope.lifecycleKind === "published"
    ? (scope.settledCompensations ?? [])
    : [];
}
