import { z } from "zod";
import type { Prisma, MediaItem } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { removalConfirmation } from "#infrastructure/removal-confirmation.ts";
import {
  PlexAccessSchema,
  type PlexAccess,
} from "#shared/plex-binding/contract.ts";

export type VisibleMedia = Pick<MediaItem, "kind" | "externalIds"> & {
  parent?:
    | (Pick<MediaItem, "externalIds"> & {
        parent?: Pick<MediaItem, "externalIds"> | null;
      })
    | null;
};
export type VisibilitySections = { movie: string; series: string };
export type VisibilityPlexAccess = (
  sectionType: "movie" | "show",
) => Promise<PlexAccess>;

/** Capture only the requested kind, outside the read transaction. */
export async function captureVisibilityPlexAccess(
  settings: {
    serverMachineId?: string | undefined;
    movieSectionId?: string | undefined;
    sections?: VisibilitySections | undefined;
    plexAccess?: VisibilityPlexAccess | undefined;
  },
  kind: MediaItem["kind"],
): Promise<PlexAccess> {
  const sectionType = kind === "movie" ? "movie" : "show";
  if (settings.plexAccess !== undefined) {
    const access = PlexAccessSchema.parse(
      await settings.plexAccess(sectionType),
    );
    if (
      access.sectionType !== sectionType ||
      access.serverMachineId !== settings.serverMachineId
    )
      throw new Error(
        "Visibility Plex configuration returned a different server or kind",
      );
    return access;
  }
  const sectionId =
    sectionType === "movie"
      ? (settings.movieSectionId ?? settings.sections?.movie)
      : settings.sections?.series;
  if (sectionId === undefined || settings.serverMachineId === undefined)
    throw new MediaError(
      "plex_scope_unconfigured",
      "Configure the requested Plex library",
      409,
    );
  return PlexAccessSchema.parse({
    serverMachineId: settings.serverMachineId,
    sectionId,
    sectionType,
  });
}
export const visibilityAncestry = {
  parent: { include: { parent: true } },
} as const;

/** Read scope deliberately does not require acquisition permission. Keep/pin remain usable. */
export async function visibilityReader(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  settings: {
    serverMachineId?: string | undefined;
    sections?: Partial<VisibilitySections> | undefined;
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
    sections?: Partial<VisibilitySections> | undefined;
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
