import { z } from "zod";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { assertAttemptMovieChoice } from "#automation/editions/choice.ts";
import type { AcquisitionAccess } from "#infrastructure/acquisition-identity/sponsor.ts";
import { MediaError } from "#application/errors.ts";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { assertLegacySubmissionSponsor } from "#infrastructure/acquisition-identity/sponsor.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  effectiveRequestWhere,
  lockEffectiveRequests,
} from "#infrastructure/request-claims.ts";

/** No automatic transaction retry: the enclosed qBit mutation may have happened. */
export async function authorizedSubmission(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  effect: (signal: AbortSignal, beforeMutation: () => void) => Promise<void>,
): Promise<boolean> {
  const movieAccess = await networkMovieAccess(context, attempt.mediaIds);
  return context.db.$transaction(
    async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: attempt.mediaIds,
      });
      await lockEffectiveRequests(tx, attempt.mediaIds);
      if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)))
        return false;
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      const choice = await assertAttemptMovieChoice(
        tx,
        current.id,
        movieAccess,
      );
      if (
        !(await submissionIdentityAuthorized(tx, current, {
          serverMachineId: context.serverMachineId,
          movieAccess,
        }))
      )
        return false;
      if (
        current.edition !== "default" ||
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
        where: { edition: "default", mediaId: { in: attempt.mediaIds } },
      });
      if (
        intents.length !== attempt.mediaIds.length ||
        intents.some(
          (intent) =>
            !intent.desiredPresence ||
            intent.automationEpoch !== attempt.recoveryEpoch ||
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
      const signal = AbortSignal.timeout(10_000);
      const beforeMutation = () => {
        signal.throwIfAborted();
        choice?.assertActive();
      };
      beforeMutation();
      await effect(signal, beforeMutation);
      return true;
    },
    { timeout: 20_000 },
  );
}

async function submissionIdentityAuthorized(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  access: AcquisitionAccess,
) {
  try {
    await assertAttemptIdentity(tx, attempt, access);
    await assertLegacySubmissionSponsor(tx, attempt, access);
    return true;
  } catch (error) {
    if (
      error instanceof MediaError &&
      (error.code === "acquisition_sponsor_changed" ||
        error.code.startsWith("edition_"))
    )
      return false;
    throw error;
  }
}
