import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexPublicationParent } from "#shared/plex-binding/expected.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeRestorePublication } from "#infrastructure/native-quarantine/publication.ts";
import { readOrdinaryPlexRestoration } from "./lineage.ts";
import { PlexBindingProtection } from "./errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** NEW20 resultHash binds this literal subtree; legacy plexScan/reason remain mutable siblings. */
export function plexRestoreReceiptHash(result: unknown): string {
  return identityHash(
    z.object({ restoreReceipt: z.json() }).parse(result).restoreReceipt,
  );
}

/** Full historical receipt first, followed by its exact original operation command. */
export async function readPlexRestorationParent(
  tx: Prisma.TransactionClient,
  operationId: string,
  budget = new PublicationAuthorityReadBudget(),
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  budget.consume(1);
  const resultHash = plexRestoreReceiptHash(operation.result);
  const raw = z
    .object({ restoreReceipt: z.json() })
    .parse(operation.result).restoreReceipt;
  if (
    operation.kind !== "restore_media" &&
    operation.kind !== "restore_native_quarantine"
  )
    throw new Error("Plex restoration parent is not a restoration operation");
  const restoration =
    operation.kind === "restore_native_quarantine"
      ? {
          receipt: await nativeRestorePublication(
            tx,
            operation.id,
            raw,
            budget,
          ),
        }
      : await readOrdinaryPlexRestoration(tx, operation.result);
  const { receipt } = restoration;
  const command = z
    .object({
      operationId: z.uuid(),
      kind: z.string(),
      mediaId: z.uuid(),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  if (
    command.operationId !== operation.id ||
    command.kind !== operation.kind ||
    command.mediaId !== operation.targetId ||
    command.recoveryEpoch !== receipt.recoveryEpoch ||
    !receipt.mediaIds.includes(command.mediaId)
  )
    throw new Error("Plex restoration operation command changed");
  const parent: Extract<PlexPublicationParent, { kind: "restore" }> = {
    kind: "restore",
    operationId: operation.id,
    resultHash,
    decisionId: receipt.decisionId,
    recoveryEpoch: receipt.recoveryEpoch,
  };
  return { operation, receipt, parent };
}

export async function assertPlexRestorationParent(
  tx: Prisma.TransactionClient,
  parent: Extract<PlexPublicationParent, { kind: "restore" }>,
  budget = new PublicationAuthorityReadBudget(),
) {
  const current = await readPlexRestorationParent(
    tx,
    parent.operationId,
    budget,
  );
  if (identityHash(current.parent) !== identityHash(parent))
    throw new PlexBindingProtection("scope_changed");
  return current;
}
