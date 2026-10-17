import { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";

/** Caller locks media, effective claims and runtime first; identities stay stable through commit. */
export async function authorizeRequester(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  targetUserId: string,
  settings: {
    kind: "movie" | "series" | "season" | "episode";
    serverMachineId?: string;
    sectionId?: string;
  },
): Promise<MediaActor> {
  const currentActor = await lockUnrestrictedRequesters(
    db,
    actor.id,
    targetUserId,
  );
  if (targetUserId !== actor.id && currentActor.role !== "owner")
    throw new MediaError(
      "owner_required",
      "Only the owner can request for another profile",
      403,
    );
  if (settings.serverMachineId === undefined)
    throw new MediaError(
      "plex_scope_unconfigured",
      "Plex authorization is not configured",
      503,
    );
  const mapping = await db.plexIdentityMapping.findUnique({
    where: { userId: targetUserId },
  });
  if (
    mapping?.serverMachineId !== settings.serverMachineId ||
    mapping.verifiedAt === null ||
    (targetUserId === actor.id && mapping.plexRestricted) ||
    mapping.verifiedAt.getTime() > Date.now() ||
    Date.now() - mapping.verifiedAt.getTime() > 300_000 ||
    !mapping.permittedMediaKinds.includes(
      settings.kind === "movie" ? "movie" : "series",
    ) ||
    mapping.permittedSectionIds.length === 0 ||
    (settings.sectionId !== undefined &&
      !mapping.permittedSectionIds.includes(settings.sectionId)) ||
    (targetUserId !== actor.id &&
      (mapping.kind !== "managed" || mapping.homeUserId === null))
  )
    throw new MediaError(
      "plex_library_access_required",
      "Refresh this profile's permitted Plex library access before requesting",
      403,
    );
  return currentActor;
}

async function lockUnrestrictedRequesters(
  db: Prisma.TransactionClient,
  actorId: string,
  targetUserId: string,
): Promise<MediaActor> {
  const ids = [...new Set([actorId, targetUserId])].sort();
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaUser" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
  );
  await db.$queryRaw(
    Prisma.sql`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" IN (${Prisma.join(ids)}) ORDER BY "userId" FOR SHARE`,
  );
  const currentActor = await db.mediaUser.findUnique({
    where: { id: actorId },
  });
  if (currentActor === null)
    throw new MediaError("unauthenticated", "Sign in again", 401);
  const requester = await db.mediaUser.findUniqueOrThrow({
    where: { id: targetUserId },
  });
  if (currentActor.restricted || requester.restricted)
    throw new MediaError(
      "requests_restricted",
      "This profile cannot create requests",
      403,
    );
  return currentActor;
}
