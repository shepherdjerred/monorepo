import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { NativeQuarantineRestorationSchema } from "#shared/native-recovery/quarantine.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { validateNativePlexReceipt } from "#infrastructure/plex-binding/native/native-version.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

export async function nativeRestorePublication(
  tx: Prisma.TransactionClient,
  operationId: string,
  raw: unknown,
  budget = new PublicationAuthorityReadBudget(),
) {
  const receipt = NativeQuarantineRestorationSchema.parse(raw);
  const row = await tx.nativeQuarantineContinuation.findUniqueOrThrow({
    where: { id: receipt.continuationId },
    include: { receipt: { include: { plan: true } } },
  });
  budget.consume(2);
  const original = NativeQuarantineRestorationSchema.parse(row.restoration);
  await validateNativePlexReceipt(tx, row.receipt, budget);
  const stable = ({
    generations: _generations,
    ...rest
  }: z.infer<typeof NativeQuarantineRestorationSchema>) => rest;
  if (
    row.state !== "restored" ||
    row.recoveryEpoch !== receipt.recoveryEpoch ||
    row.coordinatorOperationId !== operationId ||
    row.restoration === null ||
    row.receipt.plan.state !== "applied" ||
    row.receipt.plan.planHash !== row.receipt.planHash ||
    row.receipt.plan.plan === null ||
    snapshotHash(z.json().parse(row.receipt.plan.plan)) !==
      row.receipt.planHash ||
    snapshotHash(z.json().parse(stable(original))) !==
      snapshotHash(z.json().parse(stable(receipt))) ||
    receipt.mediaIds.some(
      (id) =>
        original.generations[id] === undefined ||
        receipt.generations[id] === undefined ||
        receipt.generations[id] < original.generations[id],
    )
  )
    throw new Error("Native quarantine restoration receipt changed");
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  if (operation.kind !== "restore_native_quarantine")
    throw new Error("Native quarantine publication operation changed");
  return receipt;
}
