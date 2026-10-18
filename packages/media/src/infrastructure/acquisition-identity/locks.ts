import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";

/** Acquire canonical roots first, then affected non-root rows. Call before claims/runtime/identity locks. */
export async function lockAcquisitionMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  const targets = await lockDefaultScopes(
    tx,
    mediaIds.map((id) => defaultScope(id)),
    {
      createMissing: false,
    },
  );
  if (targets.some(({ target }) => target.lineage !== "resolved"))
    throw new MediaError(
      "lineage_unresolved",
      "Canonical media ancestry needs reconciliation",
      409,
    );
}
