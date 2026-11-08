import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";

/** Read the real submission/finalization producer's unchanged outbox envelope. */
export async function perEpisodeSeedCommand(
  db: Database,
  torrentId: string,
  epoch: number,
) {
  const operation = await db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `seed:${torrentId}` },
  });
  const envelope = z
    .strictObject({
      kind: z.literal("maintain_torrent"),
      recoveryEpoch: z.int().nonnegative(),
      operationId: z.uuid(),
      torrentId: z.uuid(),
    })
    .parse(operation.payload);
  if (
    operation.kind !== "maintain_torrent" ||
    operation.targetId !== torrentId ||
    envelope.operationId !== operation.id ||
    envelope.torrentId !== torrentId ||
    envelope.recoveryEpoch !== epoch
  )
    throw new Error("Actual source command differs from its original producer");
  return { operationId: envelope.operationId, torrentId: envelope.torrentId };
}
