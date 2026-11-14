import type { Prisma } from "#generated/prisma/client.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import type { z } from "zod";
import type { PersonalMigrationCursorSchema } from "#shared/personal-migration/contract.ts";
import { personalHoldProjection } from "./hold-projection.ts";

/** The import receipt accounts source interest. It does not masquerade as a
 * household recovery review and cannot release any real/manual recovery hold. */
export async function releasePersonalMigrationHolds(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    eventId: string;
    after?: z.infer<typeof PersonalMigrationCursorSchema> | null;
    scopes?: { mediaId: string; edition: string }[];
  },
) {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const holds = await tx.recoveryHold.findMany({
    where: {
      reason: "migration_household_intent_review_required",
      recoveryEpoch: runtime.recoveryEpoch,
      releasedAt: null,
      target: { OR: [{ libraryKeep: true }, { libraryPolicyExplicit: true }] },
      ...(input.scopes === undefined ? {} : { OR: input.scopes }),
      ...(input.after == null
        ? {}
        : {
            AND: [
              {
                OR: [
                  { mediaId: { gt: input.after.mediaId } },
                  {
                    mediaId: input.after.mediaId,
                    edition: { gt: input.after.edition },
                  },
                ],
              },
            ],
          }),
    },
    include: { media: true },
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
    take: 26,
  });
  let released = 0;
  for (const hold of holds.slice(0, 25)) {
    const projection = await personalHoldProjection(tx, hold);
    if (projection.claims.length > 0 || projection.blockers.length > 0)
      continue;
    const changed = await tx.recoveryHold.updateMany({
      where: {
        mediaId: hold.mediaId,
        edition: hold.edition,
        version: hold.version,
        reason: hold.reason,
        recoveryEpoch: runtime.recoveryEpoch,
        releasedAt: null,
      },
      data: {
        releasedAt: new Date(),
        releasedById: input.actorId,
        releaseEvidence: {
          kind: "personal_state_imported",
          eventId: input.eventId,
          recoveryEpoch: runtime.recoveryEpoch,
        },
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw new Error(
        "Personal migration generated hold changed during accounting",
      );
    released++;
  }
  const last = holds[24];
  return {
    released,
    next:
      last !== undefined && holds.length > 25
        ? {
            mediaId: last.mediaId,
            edition: MovieEditionKeySchema.parse(last.edition),
          }
        : null,
  };
}
