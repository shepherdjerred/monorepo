import { z } from "zod";
import type {
  MediaItem,
  MediaUser,
  PlexIdentityMapping,
} from "#generated/prisma/client.ts";

/** A fresh exact denial can exclude an unrelated person; missing evidence cannot. */
export function hasProvenNoRecoveryAccess(input: {
  user: MediaUser & { plexIdentity: PlexIdentityMapping | null };
  media: MediaItem[];
  relevantUserIds: Set<string>;
  machineId: string;
}) {
  const { user, media, relevantUserIds, machineId } = input;
  if (relevantUserIds.has(user.id)) return false;
  const mapping = user.plexIdentity;
  if (
    mapping?.serverMachineId !== machineId ||
    mapping.verifiedAt === null ||
    mapping.verifiedAt < new Date(Date.now() - 300_000) ||
    mapping.verifiedAt > new Date()
  )
    return false;
  return media.every((item) => {
    const section = z
      .object({ plexSectionId: z.string().optional() })
      .parse(item.externalIds).plexSectionId;
    if (section === undefined) return false;
    return (
      !mapping.permittedSectionIds.includes(section) ||
      !mapping.permittedMediaKinds.includes(
        item.kind === "movie" ? "movie" : "series",
      )
    );
  });
}
