import type { z } from "zod";
import type { SettledNativeCompensationSchema } from "#shared/native-recovery/compensation-runtime.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeArchiveFile } from "#shared/native-recovery/archive.ts";
import { compensationRecord } from "#infrastructure/native-compensation/records.ts";
import { resolvePublicationTransitionAuthority } from "#infrastructure/publication-proof/authority.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  nativeAttempt,
  nativeJson,
} from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeGrantSettlements } from "./native-settlements.ts";

/** Only completed, whole-group physical references can settle an unchanged interrupted attempt. */
export async function archiveCompensationSettlements(
  tx: Prisma.TransactionClient,
  files: readonly NativeArchiveFile[],
  budget: PublicationAuthorityReadBudget,
) {
  const attempts = new Set<string>();
  const continuations = new Set<string>();
  for (const file of files) {
    const reference = await settlementReference(tx, file, budget);
    const dependencies =
      reference.kind === "prior_native_binding"
        ? await nativeGrantSettlements(tx, reference, budget)
        : [];
    const candidates =
      reference.kind === "compensation_completion"
        ? [{ continuationId: reference.continuationId, dependency: null }]
        : dependencies.map((dependency) => ({
            continuationId: dependency.continuationId,
            dependency,
          }));
    for (const { continuationId, dependency } of candidates) {
      if (continuations.has(continuationId)) continue;
      continuations.add(continuationId);
      const attemptId = await validatedSettlement(
        tx,
        { continuationId, dependency, files },
        budget,
      );
      attempts.add(attemptId);
    }
  }
  return [...attempts].sort();
}

async function settlementReference(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  budget: PublicationAuthorityReadBudget,
) {
  if (file.authority.kind !== "publication_transition_binding")
    return file.authority;
  const result = await resolvePublicationTransitionAuthority(
    tx,
    { transitionId: file.authority.transitionId, assetId: file.assetId },
    budget,
  );
  return result.originalGrant;
}
async function validatedSettlement(
  tx: Prisma.TransactionClient,
  input: {
    continuationId: string;
    dependency: z.infer<typeof SettledNativeCompensationSchema> | null;
    files: readonly NativeArchiveFile[];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { continuationId, dependency, files } = input;
  const record = await compensationRecord(tx, continuationId, budget);
  const completion = record.completion;
  if (
    completion === null ||
    record.row.state !== "compensated" ||
    completion.predecessorBindings.some(
      (binding) => !files.some((item) => item.assetId === binding.after.id),
    )
  )
    throw new Error(
      "Archive compensation settlement requires the whole completed physical group",
    );
  if (
    dependency !== null &&
    (dependency.descriptorHash !== record.row.descriptorHash ||
      dependency.completionHash !== snapshotHash(nativeJson(completion)) ||
      snapshotHash(nativeJson(dependency.settlement)) !==
        snapshotHash(nativeJson(completion.settlement)) ||
      snapshotHash(nativeJson(dependency.retainedArtifacts)) !==
        snapshotHash(nativeJson(completion.retainedArtifacts)) ||
      snapshotHash(nativeJson(dependency.journals)) !==
        snapshotHash(nativeJson(completion.journals)))
  )
    throw new Error("Archive native compensation dependency changed");
  const settlement = completion.settlement;
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: settlement.attemptId },
  });
  if (
    settlement.transitionId !== record.row.transitionId ||
    settlement.attemptId !== record.row.transition.attemptId ||
    snapshotHash(nativeAttempt(attempt)) !== settlement.attemptSnapshotHash ||
    snapshotHash(nativeJson(settlement.releasedReservations)) !==
      settlement.reservationSetHash ||
    (await tx.acquisitionReservation.count({
      where: { attemptId: attempt.id },
    })) !== 0
  )
    throw new Error("Archive compensation settlement authority changed");

  return attempt.id;
}
