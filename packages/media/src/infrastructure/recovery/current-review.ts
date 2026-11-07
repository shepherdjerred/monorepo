import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MediaError } from "#application/errors.ts";
import { RecoveryScopeSchema, isRecoveryScopeV2 } from "#shared/recovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertCompensationGroupUnchanged } from "#infrastructure/native-compensation/routing.ts";
import {
  lockRecoveryScope,
  snapshotRecoveryScope,
  recoveryConflict,
} from "./scope.ts";
import { assertLegacyRecoveryProtocol } from "./protocol.ts";

export async function currentReview(
  db: Prisma.TransactionClient,
  id: string,
  machineId: string,
  budget?: PublicationAuthorityReadBudget,
) {
  const initial = await db.recoveryReview.findUnique({ where: { id } });
  budget?.consume(initial === null ? 0 : 1);
  if (initial === null)
    throw new MediaError(
      "recovery_not_found",
      "Recovery review not found",
      404,
    );
  assertLegacyRecoveryProtocol(initial.scope);
  const scope = RecoveryScopeSchema.parse(initial.scope);
  await lockRecoveryScope(
    db,
    scope.media.map((media) => media.id),
  );
  await assertCompensationGroupUnchanged(
    db,
    scope.media.map((media) => media.id),
    scope.media.map((media) => media.id),
  );
  await db.$queryRaw`SELECT id FROM "RecoveryReview" WHERE id = ${id} FOR UPDATE`;
  const review = await db.recoveryReview.findUniqueOrThrow({ where: { id } });
  budget?.consume(1);
  if (review.state !== "awaiting_responses" || review.expiresAt <= new Date())
    throw recoveryConflict(
      "Prepare a new recovery review; this review is closed or expired",
    );
  const current = await snapshotRecoveryScope(
    db,
    scope.media.map((media) => media.id),
    machineId,
    budget === undefined
      ? isRecoveryScopeV2(scope)
        ? 2
        : 1
      : { version: isRecoveryScopeV2(scope) ? 2 : 1, budget },
  );
  if (snapshotHash(nativeJson(current)) !== review.scopeHash)
    throw recoveryConflict(
      "Household, requests, pins, physical coverage or recovery authority changed; prepare a fresh review",
    );
  return { review, scope };
}
