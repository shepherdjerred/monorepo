import { z } from "zod";
import type { Prisma, MediaItem } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { removalConfirmation } from "#infrastructure/removal-confirmation.ts";

export type VisibleMedia = Pick<MediaItem, "kind" | "externalIds"> & {
  parent?:
    | (Pick<MediaItem, "externalIds"> & {
        parent?: Pick<MediaItem, "externalIds"> | null;
      })
    | null;
};
export type VisibilitySections = { movie: string; series: string };
export const visibilityAncestry = {
  parent: { include: { parent: true } },
} as const;

/** Read scope deliberately does not require acquisition permission. Keep/pin remain usable. */
export async function visibilityReader(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  settings: {
    serverMachineId?: string | undefined;
    sections?: VisibilitySections | undefined;
  },
) {
  const access = await assessVisibilityAccess(tx, actor, settings);
  if (access.reader === null)
    throw new MediaError(
      "plex_library_access_required",
      "Refresh your library access",
      403,
    );
  return { user: access.user, ...access.reader };
}

/** Missing/stale external permission is an expected read denial, never an internal-error fallback. */
export async function assessVisibilityAccess(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  settings: {
    serverMachineId?: string | undefined;
    sections?: VisibilitySections | undefined;
  },
) {
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${actor.id} FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "PlexIdentityMapping" WHERE "userId" = ${actor.id} FOR SHARE`;
  const user = await tx.mediaUser.findUnique({
    where: { id: actor.id },
    include: { plexIdentity: true },
  });
  if (user === null)
    throw new MediaError("unauthenticated", "Sign in again", 401);
  const mapping = user.plexIdentity;
  const now = Date.now();
  if (
    settings.serverMachineId === undefined ||
    mapping?.serverMachineId !== settings.serverMachineId ||
    mapping.verifiedAt === null ||
    mapping.verifiedAt.getTime() > now ||
    now - mapping.verifiedAt.getTime() > 300_000
  )
    return { user, reader: null };
  return {
    user,
    reader: {
      owner: user.role === "owner" && !user.restricted,
      visible: (item: VisibleMedia): boolean => {
        const kind = item.kind === "movie" ? "movie" : "series";
        const sections = [item, item.parent, item.parent?.parent].flatMap(
          (row) =>
            row == null
              ? []
              : [
                  z
                    .object({ plexSectionId: z.string().optional() })
                    .parse(row.externalIds).plexSectionId,
                ],
        );
        const section =
          sections.find((value) => value !== undefined) ??
          settings.sections?.[kind];
        return (
          mapping.permittedMediaKinds.includes(kind) &&
          section !== undefined &&
          mapping.permittedSectionIds.includes(section)
        );
      },
    },
  };
}

/** Only measured, public quality facts; never scene names, file paths or raw evidence. */
export function publicAssetProperties(raw: Prisma.JsonValue) {
  return z
    .object({
      quality: z.string().optional(),
      codec: z.string().optional(),
      sizeBytes: z.number().nonnegative().optional(),
      audioLanguages: z.array(z.string()).optional(),
      hdr: z.boolean().optional(),
    })
    .parse(raw);
}

export async function scopedRemovalConfirmation(
  tx: Prisma.TransactionClient,
  mediaId: string,
  visible: (item: VisibleMedia) => boolean,
) {
  const confirmation = await removalConfirmation(tx, mediaId);
  const media = await tx.mediaItem.findMany({
    where: { id: { in: confirmation.media.map((item) => item.id) } },
    include: visibilityAncestry,
  });
  return media.every((item) => visible(item))
    ? { removalConfirmation: confirmation }
    : {};
}
