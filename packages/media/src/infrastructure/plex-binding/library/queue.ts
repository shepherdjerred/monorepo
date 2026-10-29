import type { Prisma } from "#generated/prisma/client.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Called by the transaction that owns the actual adoption receipt; no personal request is created. */
export async function queueLibraryPlexBinding(
  tx: Prisma.TransactionClient,
  input: {
    receiptId: string;
    assetId: string;
    recoveryEpoch: number;
    actorId: string;
    renewalBucket: number;
  },
) {
  if (!Number.isSafeInteger(input.renewalBucket) || input.renewalBucket < 0)
    throw new Error("Invalid library Plex renewal bucket");
  const idempotencyKey = `library-plex:${input.receiptId}:${input.assetId}:${String(input.renewalBucket)}`;
  const existing = await tx.operation.findUnique({ where: { idempotencyKey } });
  const payload = LibraryPlexBindingInputV1Schema.parse({
    schemaVersion: 1,
    kind: "verify_library_plex_binding",
    operationId: existing?.id ?? crypto.randomUUID(),
    receiptId: input.receiptId,
    assetId: input.assetId,
    recoveryEpoch: input.recoveryEpoch,
  });
  if (existing !== null) {
    if (
      existing.kind !== payload.kind ||
      existing.targetId !== input.assetId ||
      existing.userId !== input.actorId ||
      identityHash(existing.payload) !== identityHash(payload)
    )
      throw new Error("Library Plex queued command changed");
    return existing.id;
  }
  await tx.operation.create({
    data: {
      id: payload.operationId,
      idempotencyKey,
      kind: payload.kind,
      targetId: input.assetId,
      userId: input.actorId,
      payload,
      outbox: { create: { kind: payload.kind, payload } },
    },
  });
  return payload.operationId;
}
