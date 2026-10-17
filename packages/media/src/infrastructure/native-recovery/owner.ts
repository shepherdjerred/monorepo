import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError, requireOwner } from "#application/errors.ts";

export async function assertNativeOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actorId} FOR SHARE`;
  const actor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actorId },
  });
  requireOwner(actor);
  if (actor.restricted)
    throw new MediaError(
      "forbidden",
      "Native recovery requires the current unrestricted owner",
      403,
    );
  return actor;
}
