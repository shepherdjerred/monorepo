import type { CustomActivityClaims } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  customActivityActor,
  type CustomActivityActor,
} from "#src/customs/activity/activity-actor.ts";
import { requiredCustomSnapshot } from "#src/customs/activity/activity-mutation-context.ts";

/** Read independently of the active-night pointer so reconnects retain recovery. */
export async function readPendingCustomCleanups(
  db: ExtendedPrismaClient,
  actor: CustomActivityActor,
) {
  const nights = await db.customNight.findMany({
    where: {
      guildId: actor.guildId,
      state: "ENDED",
      operations: { some: { state: { in: ["held", "queued", "running"] } } },
      ...(actor.administrator
        ? {}
        : {
            OR: [
              { hostDiscordId: actor.discordId },
              { cohosts: { some: { discordId: actor.discordId } } },
            ],
          }),
    },
    orderBy: [{ endedAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return await Promise.all(
    nights.map(
      async (night) => await requiredCustomSnapshot(db, night.id, actor),
    ),
  );
}

export async function pendingCustomCleanups(claims: CustomActivityClaims) {
  return await readPendingCustomCleanups(
    prisma,
    await customActivityActor(claims),
  );
}
