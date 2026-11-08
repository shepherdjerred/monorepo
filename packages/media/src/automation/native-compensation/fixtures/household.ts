import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";

/** Synthetic fresh account access; household intent itself is written only through the real review API. */
export async function reconcileCompensationHousehold(
  db: Database,
  input: {
    owner: MediaActor;
    requester: MediaActor;
    mediaIds: readonly string[];
    negativeMediaIds?: readonly string[];
    kind: "movie" | "episode";
    serverMachineId: string;
  },
) {
  const relevantUsers = new Set([input.owner.id, input.requester.id]);
  for (const user of await db.mediaUser.findMany()) {
    const relevant = relevantUsers.has(user.id);
    const movieAccess = relevant === (input.kind === "movie");
    const mapping = {
      serverMachineId: input.serverMachineId,
      serverAccountId: user.plexAccountId,
      kind: "account",
      homeUserId: null,
      permittedSectionIds: [movieAccess ? "1" : "2"],
      permittedMediaKinds: [movieAccess ? "movie" : "series"],
      plexRestricted: false,
      verifiedAt: new Date(),
    };
    await db.plexIdentityMapping.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...mapping },
      update: { ...mapping, version: { increment: 1 } },
    });
  }
  const service = new PrismaRecovery(db, input.serverMachineId);
  const selected = input.mediaIds[0];
  if (selected === undefined)
    throw new Error("Household fixture has no covered leaf");
  const command = await service.prepare(input.owner, crypto.randomUUID(), {
    mediaIds: [selected],
  });
  const reviewId = z.uuid().parse(command.recoveryReviewId);
  const initial = await service.detail(input.owner, reviewId);
  if (initial.scope.blockers.length > 0)
    throw new Error(
      `Actual household review remains protected: ${JSON.stringify(initial.scope.blockers)}`,
    );
  for (const actor of [input.owner, input.requester]) {
    await service.respond(actor, crypto.randomUUID(), reviewId, {
      scopeHash: initial.scopeHash,
      declarations: input.mediaIds.map((mediaId) => ({
        mediaId,
        intent:
          input.negativeMediaIds?.includes(mediaId) === true
            ? "no_longer_request"
            : "request",
      })),
      acknowledgePending: true,
    });
  }
  const reviewed = await service.detail(input.owner, reviewId);
  const result = await service.release(
    input.owner,
    crypto.randomUUID(),
    reviewId,
    {
      expectedVersion: reviewed.version,
      scopeHash: reviewed.scopeHash,
      responseHash: z.string().parse(reviewed.responseHash),
      confirmHouseholdBaseline: true,
      confirmExistingPins: true,
      acknowledgeMissingHistory: true,
    },
  );
  return { service, reviewId, initial, result };
}
