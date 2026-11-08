import { Prisma } from "#generated/prisma/client.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { defaultScope } from "#shared/editions/scope.ts";

/** Data only; each recovery protocol retains its actual upsert and transaction boundary. */
export function unconfirmedRecoveryHoldWrite(
  mediaId: string,
  recoveryEpoch: number,
) {
  return {
    where: targetWhere(defaultScope(mediaId)),
    create: {
      mediaId,
      recoveryEpoch,
      reason: "recovery_request_history_unconfirmed",
    },
    update: {
      recoveryEpoch,
      reason: "recovery_request_history_unconfirmed",
      releasedAt: null,
      releasedById: null,
      releaseEvidence: Prisma.DbNull,
      version: { increment: 1 },
    },
  };
}
