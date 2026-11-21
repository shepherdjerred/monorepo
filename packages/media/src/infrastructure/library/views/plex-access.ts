import {
  PlexAccessSchema,
  type PlexAccess,
} from "#shared/plex-binding/contract.ts";
import type { VisibilitySections } from "#infrastructure/visibility/access.ts";

export type LibraryReadSettings = {
  serverMachineId?: string | undefined;
  sections?: Partial<VisibilitySections> | undefined;
};

/** The configured Plex libraries the reader is currently permitted to open. */
export function permittedPlexAccess(
  settings: LibraryReadSettings,
  user: { plexIdentity: { permittedSectionIds: string[] } | null },
): PlexAccess[] {
  return (["movie", "series"] as const).flatMap((kind) => {
    const sectionId = settings.sections?.[kind];
    return sectionId === undefined ||
      settings.serverMachineId === undefined ||
      user.plexIdentity?.permittedSectionIds.includes(sectionId) !== true
      ? []
      : [
          PlexAccessSchema.parse({
            serverMachineId: settings.serverMachineId,
            sectionId,
            sectionType: kind === "movie" ? "movie" : "show",
          }),
        ];
  });
}

/**
 * A movie's availability as a library view shows it: present in a permitted
 * unmanaged Plex library counts as available. A series has no single state.
 */
export function libraryAvailability<Availability extends string>(
  media: { id: string; kind: string; availability: Availability },
  external: ReadonlySet<string>,
): Availability | "available" | null {
  if (media.kind === "series") return null;
  return external.has(media.id) ? "available" : media.availability;
}
