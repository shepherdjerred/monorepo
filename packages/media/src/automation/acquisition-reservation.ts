import { z } from "zod";
import type { MediaAutomationContext } from "./context.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import type {
  MediaOperation,
  MediaNetworkActivities,
} from "#shared/automation.ts";
import type { QualityProfile } from "#shared/contract.ts";
import { chooseUpgrade, evaluateRelease } from "#domain/quality.ts";
import { serializable } from "./store.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { sponsorClaim } from "#infrastructure/action-guards.ts";
import { currentRelease } from "./acquisition-candidates.ts";
const GenerationsSchema = z.record(z.string(), z.number().int().nonnegative());
export async function reserveCandidate(
  context: MediaAutomationContext,
  input: MediaOperation,
  options: { releaseId: string; profile: QualityProfile; epoch: number },
): Promise<string | null> {
  const { releaseId, profile, epoch } = options;
  const proposed = await context.db.releaseCandidate.findUniqueOrThrow({
    where: { id: releaseId },
  });
  const candidate = {
    id: proposed.id,
    providerId: proposed.providerId,
    title: proposed.title,
    ...PublicReleaseAttributesSchema.parse(proposed.attributes),
  };
  for (const mediaId of proposed.mediaIds) {
    if (
      !chooseUpgrade({
        candidate,
        current: await currentRelease(context, mediaId),
        profile,
        mediaIds: [mediaId],
      }).upgrade
    )
      return null;
  }
  return serializable(context.db, async (tx) => {
    await lockMedia(tx, proposed.mediaIds);
    await tx.mediaItem.update({
      where: { id: input.mediaId },
      data: { version: { increment: 1 } },
    });
    const intent = await tx.mediaIntent.findUniqueOrThrow({
      where: { mediaId: input.mediaId },
    });
    if (
      intent.generation !== input.generation ||
      !intent.desiredPresence ||
      !intent.monitoring ||
      intent.profileId !== profile.id
    )
      return null;
    const existing = await tx.acquisitionReservation.findUnique({
      where: { mediaId: input.mediaId },
    });
    if (existing !== null) return null;
    const sponsor = await tx.mediaRequest.findFirst({
      where: { mediaId: input.mediaId, ...effectiveRequestWhere },
      orderBy: { createdAt: "asc" },
    });
    if (sponsor === null) return null;
    const release = await tx.releaseCandidate.findUniqueOrThrow({
      where: { id: releaseId },
    });
    const mediaIds = [...new Set(release.mediaIds)].sort();
    if (!mediaIds.includes(input.mediaId))
      throw new Error("Candidate coverage omitted requested media");
    const generations: Record<string, number> = {};
    for (const mediaId of mediaIds) {
      await tx.mediaItem.update({
        where: { id: mediaId },
        data: { version: { increment: 1 } },
      });
      const reserved = await tx.acquisitionReservation.findUnique({
        where: { mediaId },
      });
      if (reserved !== null) return null;
      const coveredIntent = await tx.mediaIntent.findUnique({
        where: { mediaId },
      });
      if (
        coveredIntent !== null &&
        (coveredIntent.intentionallyRemovedAt !== null ||
          (coveredIntent.profileId !== null &&
            coveredIntent.profileId !== profile.id))
      )
        return null;
      const claimed = await tx.mediaIntent.upsert({
        where: { mediaId },
        create: { mediaId, generation: 1, profileId: profile.id },
        update: { desiredPresence: true, profileId: profile.id },
      });
      generations[mediaId] = claimed.generation;
      if (mediaId !== input.mediaId)
        await sponsorClaim(tx, sponsor.userId, sponsor.id, {
          mediaId,
          subtitleLanguages: sponsor.subtitleLanguages,
        });
    }
    const attempt = await tx.acquisitionAttempt.create({
      data: {
        releaseId,
        sponsorRequestId: sponsor.id,
        mediaIds,
        generations,
        state: "reserved",
        operationId: input.operationId,
        coordinatorOperationId: input.operationId,
        recoveryEpoch: epoch,
        failure: { profileId: profile.id, profileVersion: profile.version },
        reservations: {
          create: mediaIds.map((mediaId) => ({
            mediaId,
            generation: z.number().parse(generations[mediaId]),
          })),
        },
      },
    });
    await tx.operation.update({
      where: { id: input.operationId },
      data: { status: "running" },
    });
    await tx.mediaItem.update({
      where: { id: input.mediaId },
      data: { availability: "searching" },
    });
    return attempt.id;
  });
}

export async function adoptReservation(
  context: MediaAutomationContext,
  input: MediaOperation,
  profile: QualityProfile,
): Promise<Awaited<
  ReturnType<MediaNetworkActivities["reconcileMediaIntent"]>
> | null> {
  return serializable(context.db, async (tx) => {
    await lockMedia(tx, [input.mediaId]);
    const reservation = await tx.acquisitionReservation.findUnique({
      where: { mediaId: input.mediaId },
      include: { attempt: { include: { release: true } } },
    });
    if (reservation === null) return null;
    const waiting = {
      status: "waiting" as const,
      attemptId: null,
      reason: "existing_acquisition",
    };
    const attributes = {
      id: reservation.attempt.release.id,
      providerId: reservation.attempt.release.providerId,
      title: reservation.attempt.release.title,
      ...PublicReleaseAttributesSchema.parse(
        reservation.attempt.release.attributes,
      ),
    };
    const evaluation = evaluateRelease(attributes, profile, [input.mediaId]);
    if (!evaluation.accepted) return waiting;
    const generations = GenerationsSchema.parse(
      reservation.attempt.generations,
    );
    await tx.acquisitionReservation.update({
      where: { mediaId: input.mediaId },
      data: { generation: input.generation },
    });
    await tx.acquisitionAttempt.update({
      where: { id: reservation.attemptId },
      data: {
        generations: { ...generations, [input.mediaId]: input.generation },
        failure: {
          ...z
            .record(z.string(), z.json())
            .parse(reservation.attempt.failure ?? {}),
          profileId: profile.id,
          profileVersion: profile.version,
        },
      },
    });
    const coordinatorId =
      reservation.attempt.coordinatorOperationId ??
      reservation.attempt.operationId;
    const coordinator = await tx.operation.findUniqueOrThrow({
      where: { id: coordinatorId },
    });
    if (
      coordinatorId !== input.operationId &&
      (coordinator.status === "queued" || coordinator.status === "running")
    )
      return waiting;
    await tx.acquisitionAttempt.update({
      where: { id: reservation.attemptId },
      data: { coordinatorOperationId: input.operationId },
    });
    await tx.operation.update({
      where: { id: input.operationId },
      data: { status: "running" },
    });
    return {
      status: "acquire",
      attemptId: reservation.attemptId,
      reason: "resume_existing_acquisition",
    };
  });
}
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
