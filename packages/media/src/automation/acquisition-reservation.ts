import type { Prisma, MediaRequest } from "#generated/prisma/client.ts";
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
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import {
  operationCoverage,
  acquisitionIdentity,
} from "#infrastructure/acquisition-identity/acquisition.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { captureSponsorAuthority } from "#infrastructure/acquisition-identity/sponsor.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";
import { effectiveCandidate } from "#domain/acquisition-identity/effective.ts";
import { sponsorClaim } from "#infrastructure/action-guards.ts";
import { currentRelease } from "./acquisition-candidates.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
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
  const proposedIds = await operationCoverage(
    context.db,
    input.operationId,
    proposed,
  );
  return serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, proposedIds);
    await lockEffectiveRequests(tx, proposedIds);
    if (!(await lockRuntimeAuthority(tx, epoch))) return null;
    await tx.mediaItem.update({
      where: { id: input.mediaId },
      data: { version: { increment: 1 } },
    });
    const intent = await tx.mediaIntent.findUniqueOrThrow({
      where: { mediaId: input.mediaId },
    });
    if (
      intent.generation !== input.generation ||
      intent.automationEpoch !== epoch ||
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
    const identity = await reservationIdentity(tx, context, proposed, {
      operationId: input.operationId,
      sponsorRequestId: sponsor.id,
      epoch,
      mediaIds: proposedIds,
    });
    await tx.$queryRaw`SELECT id FROM "ReleaseCandidate" WHERE id = ${releaseId} FOR SHARE`;
    const release = await tx.releaseCandidate.findUniqueOrThrow({
      where: { id: releaseId },
    });
    if (
      identity !== null &&
      candidateDigest(release) !== identity.source.candidateDigest
    )
      return null;
    const mediaIds = [
      ...new Set(identity?.coverage ?? release.mediaIds),
    ].sort();
    const rawCandidate = {
      id: release.id,
      providerId: release.providerId,
      title: release.title,
      ...PublicReleaseAttributesSchema.parse(release.attributes),
    };
    const candidate =
      identity === null
        ? rawCandidate
        : effectiveCandidate(rawCandidate, identity);
    for (const mediaId of mediaIds)
      if (
        !chooseUpgrade({
          candidate,
          current: await currentRelease(context, mediaId),
          profile,
          mediaIds: [mediaId],
        }).upgrade
      )
        return null;
    if (!mediaIds.includes(input.mediaId))
      throw new Error("Candidate coverage omitted requested media");
    const generations = await claimCoverage(tx, {
      mediaIds,
      primaryId: input.mediaId,
      sponsor,
      profileId: profile.id,
      epoch,
    });
    if (generations === null) return null;
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
        ...(identity === null
          ? {}
          : {
              identityEvidence: z.record(z.string(), z.json()).parse(identity),
            }),
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

async function reservationIdentity(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  release: Parameters<typeof acquisitionIdentity>[1],
  input: Parameters<typeof acquisitionIdentity>[2],
) {
  const authority = {
    ...input,
    ...(context.serverMachineId === undefined
      ? {}
      : { serverMachineId: context.serverMachineId }),
  };
  if (release.sourceEvidence === null)
    await captureSponsorAuthority(tx, authority);
  return await acquisitionIdentity(tx, release, authority);
}

export async function adoptReservation(
  context: MediaAutomationContext,
  input: MediaOperation,
  profile: QualityProfile,
): Promise<Awaited<
  ReturnType<MediaNetworkActivities["reconcileMediaIntent"]>
> | null> {
  const snapshot = await context.db.acquisitionReservation.findUnique({
    where: { mediaId: input.mediaId },
    include: { attempt: true },
  });
  if (snapshot === null) return null;
  return serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, snapshot.attempt.mediaIds);
    await lockEffectiveRequests(tx, snapshot.attempt.mediaIds);
    const reservation = await tx.acquisitionReservation.findUnique({
      where: { mediaId: input.mediaId },
      include: { attempt: { include: { release: true } } },
    });
    if (reservation === null) return null;
    if (
      reservation.attemptId !== snapshot.attemptId ||
      !(await recordsAuthorized(tx, {
        epoch: reservation.attempt.recoveryEpoch,
        mediaIds: reservation.attempt.mediaIds,
      }))
    )
      return {
        status: "blocked",
        attemptId: null,
        reason: "record_ownership_unconfirmed",
      };
    if (!(await lockRuntimeAuthority(tx, reservation.attempt.recoveryEpoch)))
      return {
        status: "blocked",
        attemptId: null,
        reason: "recovery_epoch_changed",
      };
    const waiting = {
      status: "waiting" as const,
      attemptId: null,
      reason: "existing_acquisition",
    };
    const identity = await assertAttemptIdentity(
      tx,
      reservation.attempt,
      context.serverMachineId,
    );
    const rawAttributes = {
      id: reservation.attempt.release.id,
      providerId: reservation.attempt.release.providerId,
      title: reservation.attempt.release.title,
      ...PublicReleaseAttributesSchema.parse(
        reservation.attempt.release.attributes,
      ),
    };
    const attributes =
      identity === null
        ? rawAttributes
        : effectiveCandidate(rawAttributes, identity);
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

async function claimCoverage(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: string[];
    primaryId: string;
    sponsor: MediaRequest;
    profileId: string;
    epoch: number;
  },
) {
  const reservations = await tx.acquisitionReservation.count({
    where: { mediaId: { in: input.mediaIds } },
  });
  const intents = await tx.mediaIntent.findMany({
    where: { mediaId: { in: input.mediaIds } },
  });
  if (
    reservations > 0 ||
    intents.some(
      (intent) =>
        intent.automationEpoch !== input.epoch ||
        intent.intentionallyRemovedAt !== null ||
        (intent.profileId !== null && intent.profileId !== input.profileId),
    )
  )
    return null;
  const generations: Record<string, number> = {};
  for (const mediaId of input.mediaIds) {
    await tx.mediaItem.update({
      where: { id: mediaId },
      data: { version: { increment: 1 } },
    });
    const claimed = await tx.mediaIntent.upsert({
      where: { mediaId },
      create: {
        mediaId,
        generation: 1,
        profileId: input.profileId,
        automationEpoch: input.epoch,
      },
      update: { desiredPresence: true, profileId: input.profileId },
    });
    generations[mediaId] = claimed.generation;
    if (mediaId !== input.primaryId)
      await sponsorClaim(tx, input.sponsor.userId, input.sponsor.id, {
        mediaId,
        subtitleLanguages: input.sponsor.subtitleLanguages,
      });
  }
  return generations;
}
