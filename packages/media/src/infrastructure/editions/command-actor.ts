import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";

/** Protective actions need current role/claim authority, not acquisition access. */
export async function lockCommandActor(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
): Promise<MediaActor> {
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actor.id} FOR SHARE`;
  const current = await tx.mediaUser.findUnique({ where: { id: actor.id } });
  if (current === null)
    throw new MediaError("unauthorized", "Authentication required", 401);
  return current;
}
