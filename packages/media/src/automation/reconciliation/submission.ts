import { z } from "zod";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import {
  effectiveRequestWhere,
  lockEffectiveRequests,
} from "#infrastructure/request-claims.ts";

/** No automatic transaction retry: the enclosed qBit mutation may have happened. */
export async function authorizedSubmission(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  effect: (signal: AbortSignal) => Promise<void>,
): Promise<boolean> {
  return context.db.$transaction(
    async (tx) => {
      await lockMedia(tx, attempt.mediaIds);
      await lockEffectiveRequests(tx, attempt.mediaIds);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      if (
        runtime.mode !== "active" ||
        !runtime.ownershipConfirmed ||
        runtime.recoveryEpoch !== attempt.recoveryEpoch ||
        current.state !== "submitting" ||
        current.coordinatorOperationId !== attempt.coordinatorOperationId
      )
        return false;
      const generations = z
        .record(z.string(), z.number().int())
        .parse(current.generations);
      const snapshot = z
        .object({ profileId: z.string(), profileVersion: z.number().int() })
        .parse(current.failure);
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "QualityProfile" WHERE id = ${snapshot.profileId} FOR SHARE`,
      );
      const profile = await tx.qualityProfile.findUnique({
        where: { id: snapshot.profileId },
      });
      if (profile?.version !== snapshot.profileVersion) return false;
      const intents = await tx.mediaIntent.findMany({
        where: { mediaId: { in: attempt.mediaIds } },
      });
      if (
        intents.length !== attempt.mediaIds.length ||
        intents.some(
          (intent) =>
            !intent.desiredPresence ||
            !intent.monitoring ||
            intent.intentionallyRemovedAt !== null ||
            intent.generation !== generations[intent.mediaId] ||
            intent.profileId !== snapshot.profileId,
        )
      )
        return false;
      const claims = await tx.mediaRequest.findMany({
        where: { mediaId: { in: attempt.mediaIds }, ...effectiveRequestWhere },
        distinct: ["mediaId"],
        select: { mediaId: true },
      });
      if (
        claims.length !== attempt.mediaIds.length ||
        !(await context.gates.acquisition())
      )
        return false;
      await effect(AbortSignal.timeout(10_000));
      return true;
    },
    { timeout: 20_000 },
  );
}
