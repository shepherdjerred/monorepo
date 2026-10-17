import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";

/** Called inside the command transaction after fresh scoped Plex authorization. */
export async function authorizeRequester(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  targetUserId: string,
  settings: {
    kind: "movie" | "series" | "season" | "episode";
    serverMachineId?: string;
  },
): Promise<void> {
  const requester = await db.mediaUser.findUniqueOrThrow({
    where: { id: targetUserId },
  });
  if (requester.restricted)
    throw new MediaError(
      "requests_restricted",
      "This profile cannot create requests",
      403,
    );
  if (targetUserId !== actor.id && actor.role !== "owner")
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
    Date.now() - mapping.verifiedAt.getTime() > 300_000 ||
    !mapping.permittedMediaKinds.includes(
      settings.kind === "movie" ? "movie" : "series",
    ) ||
    mapping.permittedSectionIds.length === 0 ||
    (targetUserId !== actor.id &&
      (mapping.kind !== "managed" || mapping.homeUserId === null))
  )
    throw new MediaError(
      "plex_library_access_required",
      "Refresh this profile's permitted Plex library access before requesting",
      403,
    );
}
