import type { Database } from "#infrastructure/database.ts";
import { lockCanonicalMedia } from "#infrastructure/editions/locks.ts";
import type { Prisma } from "#generated/prisma/client.ts";

export async function reconcileRetiredQualityProfiles(
  db: Database,
  signal?: AbortSignal,
) {
  const idle = {
    reservations: { none: {} },
    media: {
      children: {
        none: {
          OR: [
            { acquisitionReservations: { some: {} } },
            { children: { some: { acquisitionReservations: { some: {} } } } },
          ],
        },
      },
    },
  } satisfies Prisma.MediaIntentWhereInput;
  let cursor: { mediaId: string; edition: string } | undefined;
  let more = true;
  while (more) {
    signal?.throwIfAborted();
    const targets = await db.mediaIntent.findMany({
      where: {
        ...idle,
        profile: { replacedByProfileId: { not: null } },
        ...(cursor === undefined
          ? {}
          : {
              OR: [
                { mediaId: { gt: cursor.mediaId } },
                { mediaId: cursor.mediaId, edition: { gt: cursor.edition } },
              ],
            }),
      },
      orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
      take: 100,
      select: {
        mediaId: true,
        edition: true,
        profileId: true,
        profile: { select: { replacedByProfileId: true } },
      },
    });
    const last = targets.at(-1);
    if (last === undefined) return;
    cursor = last;
    more = targets.length === 100;
    for (const target of targets) {
      signal?.throwIfAborted();
      await migrateIdleProfile(db, target, idle, signal);
    }
  }
}

async function migrateIdleProfile(
  db: Database,
  target: {
    mediaId: string;
    edition: string;
    profileId: string | null;
    profile: { replacedByProfileId: string | null } | null;
  },
  idle: Prisma.MediaIntentWhereInput,
  signal: AbortSignal | undefined,
) {
  const replacement = target.profile?.replacedByProfileId;
  if (replacement == null)
    throw new Error("Retired profile lost its replacement");
  await db.$transaction(
    async (tx) => {
      await lockCanonicalMedia(tx, [target.mediaId]);
      signal?.throwIfAborted();
      await tx.mediaIntent.updateMany({
        where: {
          ...idle,
          mediaId: target.mediaId,
          edition: target.edition,
          profileId: target.profileId,
        },
        data: {
          profileId: replacement,
          version: { increment: 1 },
          generation: { increment: 1 },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
