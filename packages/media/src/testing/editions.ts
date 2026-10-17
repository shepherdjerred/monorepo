import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { defaultScope } from "#shared/editions/scope.ts";

/** Establish real lineage first, then the explicit authority intended by a fixture. */
export async function createTestDefaultTarget(
  db: Database,
  mediaId: string,
  data: Omit<
    Prisma.MediaIntentUpdateInput,
    | "media"
    | "edition"
    | "definition"
    | "requests"
    | "reservations"
    | "coverage"
    | "watchStates"
    | "holds"
    | "retention"
    | "recoveryHolds"
    | "subtitlePolicies"
  > = {},
) {
  return db.$transaction(async (tx) => {
    const targets = await lockDefaultScopes(tx, [defaultScope(mediaId)], {
      createMissing: true,
    });
    if (targets[0]?.existed !== false)
      throw new Error("Fixture default target already exists");
    return tx.mediaIntent.update({
      where: targetWhere(defaultScope(mediaId)),
      data: { desiredPresence: true, monitoring: true, ...data },
    });
  });
}
