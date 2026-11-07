import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";

/** Synthetic current account access only. Every declaration and hold release
 * still goes through its genuine independent public command invocation. */
export function nativeSeriesPackHouseholdV1(
  db: Database,
  input: { owner: MediaActor; requester: MediaActor },
) {
  const service = new PrismaRecovery(db, "fixture-server");
  return {
    owner: input.owner,
    requester: input.requester,
    service,
    configureAccess: async () => {
      const relevant = new Set([input.owner.id, input.requester.id]);
      for (const user of await db.mediaUser.findMany()) {
        const series = relevant.has(user.id);
        const mapping = {
          serverMachineId: "fixture-server",
          serverAccountId: user.plexAccountId,
          kind: "account",
          homeUserId: null,
          permittedSectionIds: [series ? "2" : "1"],
          permittedMediaKinds: [series ? "series" : "movie"],
          plexRestricted: false,
          verifiedAt: new Date(),
        };
        await db.plexIdentityMapping.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...mapping },
          update: { ...mapping, version: { increment: 1 } },
        });
      }
    },
  };
}
