import {
  lockCanonicalMedia,
  lockDefaultScopes,
} from "#infrastructure/editions/locks.ts";
import { MediaError } from "#application/errors.ts";
import { networkMovieAccess } from "./editions/access.ts";
import {
  requireMovieSponsor,
  assertAttemptMovieChoice,
} from "./editions/choice.ts";
import { captureMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import {
  readDefaultTarget,
  targetWhere,
} from "#infrastructure/editions/targets.ts";
import type {
  Prisma,
  MediaRequest,
  ReleaseCandidate,
} from "#generated/prisma/client.ts";
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
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
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
  const movieAccess = await networkMovieAccess(context, proposedIds);
  return serializable(context.db, async (tx) => {
    await lockCanonicalMedia(tx, proposedIds);
    await readDefaultTarget(tx, defaultScope(input.mediaId));
    const targets = await lockDefaultScopes(
      tx,
      proposedIds.map((id) => defaultScope(id)),
      { createMissing: true },
    );
    if (targets.some(({ target }) => target.lineage !== "resolved"))
      throw new MediaError(
        "lineage_unresolved",
        "Acquisition coverage requires canonical lineage",
        409,
      );
    const newTargetIds = new Set(
      targets
        .filter(({ existed }) => !existed)
        .map(({ target }) => target.mediaId),
    );
    const result = await reserveLockedCandidate(tx, context, {
      input,
      releaseId,
      profile,
      epoch,
      proposed,
      proposedIds,
      newTargetIds,
      movieAccess,
    });
    if (result === null) await removeUnclaimedTargets(tx, newTargetIds);
    return result;
  });
}

async function removeUnclaimedTargets(
  tx: Prisma.TransactionClient,
  ids: ReadonlySet<string>,
): Promise<void> {
  if (ids.size === 0) return;
  const removed = await tx.mediaIntent.deleteMany({
    where: {
      mediaId: { in: [...ids] },
      edition: "default",
      generation: 0,
      version: 0,
      automationEpoch: -1,
      desiredPresence: false,
      monitoring: false,
      profileId: null,
      intentionallyRemovedAt: null,
    },
  });
  if (removed.count !== ids.size)
    throw new Error("Fresh reservation target changed before cleanup");
}

async function reserveLockedCandidate(
  tx: Prisma.TransactionClient,
  context: MediaAutomationContext,
  options: {
    input: MediaOperation;
    releaseId: string;
    profile: QualityProfile;
    epoch: number;
    proposed: ReleaseCandidate;
    proposedIds: string[];
    newTargetIds: ReadonlySet<string>;
    movieAccess: MovieChoiceAccess | undefined;
  },
): Promise<string | null> {
  const {
    input,
    releaseId,
    profile,
    epoch,
    proposed,
    proposedIds,
    newTargetIds,
  } = options;
  await lockEffectiveRequests(tx, proposedIds);
  await assertNoPublicationCompensationFence(tx, { mediaIds: proposedIds });
  if (!(await lockRuntimeAuthority(tx, epoch))) return null;
  await tx.mediaItem.update({
    where: { id: input.mediaId },
    data: { version: { increment: 1 } },
  });
  const intent = await tx.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(input.mediaId)),
  });
  if (
    !reservationTargetCurrent(intent, {
      generation: input.generation,
      epoch,
      profileId: profile.id,
    })
  )
    return null;
  const existing = await tx.acquisitionReservation.findUnique({
    where: targetWhere(defaultScope(input.mediaId)),
  });
  if (existing !== null) return null;
  const chosen = await requireMovieSponsor(
    tx,
    input.mediaId,
    options.movieAccess,
  );
  const sponsor =
    chosen?.request ??
    (await tx.mediaRequest.findFirst({
      where: { mediaId: input.mediaId, ...effectiveRequestWhere },
      orderBy: { createdAt: "asc" },
    }));
  if (sponsor === null) return null;
  const identity = await reservationIdentity(tx, context, proposed, {
    operationId: input.operationId,
    sponsorRequestId: sponsor.id,
    epoch,
    mediaIds: proposedIds,
    movieAccess: options.movieAccess,
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
  const mediaIds = [...new Set(identity?.coverage ?? release.mediaIds)].sort();
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
    newTargetIds,
  });
  if (generations === null) return null;
  const choice =
    chosen === null
      ? {}
      : await captureMovieAttemptChoice(tx, {
          sponsorRequestId: sponsor.id,
          scope: chosen.scope,
          access: requireMovieChoiceAccess(options.movieAccess ?? {}),
        });
  const attempt = await tx.acquisitionAttempt.create({
    data: {
      ...choice,
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
  await mirrorDefaultAvailability(tx, [input.mediaId], "searching");
  return attempt.id;
}

function reservationTargetCurrent(
  intent: {
    generation: number;
    automationEpoch: number;
    desiredPresence: boolean;
    monitoring: boolean;
    profileId: string | null;
  },
  expected: { generation: number; epoch: number; profileId: string },
) {
  return (
    intent.generation === expected.generation &&
    intent.automationEpoch === expected.epoch &&
    intent.desiredPresence &&
    intent.monitoring &&
    intent.profileId === expected.profileId
  );
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
    where: targetWhere(defaultScope(input.mediaId)),
    include: { attempt: true },
  });
  if (snapshot === null) return null;
  const recorded = ["imported", "submitting", "submission_unknown"].includes(
    snapshot.attempt.state,
  );
  const movieAccess = recorded
    ? undefined
    : await networkMovieAccess(context, snapshot.attempt.mediaIds);
  return serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, snapshot.attempt.mediaIds);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: snapshot.attempt.mediaIds,
    });
    await lockEffectiveRequests(tx, snapshot.attempt.mediaIds);
    const reservation = await tx.acquisitionReservation.findUnique({
      where: targetWhere(defaultScope(input.mediaId)),
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
    if (
      !["imported", "submitting", "submission_unknown"].includes(
        reservation.attempt.state,
      )
    )
      await assertAttemptMovieChoice(tx, reservation.attemptId, movieAccess);
    const identity = await assertAttemptIdentity(
      tx,
      reservation.attempt,
      { serverMachineId: context.serverMachineId, movieAccess },
      "resume_recorded_submission",
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
      where: targetWhere(defaultScope(input.mediaId)),
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
    newTargetIds: ReadonlySet<string>;
  },
) {
  const reservations = await tx.acquisitionReservation.count({
    where: { mediaId: { in: input.mediaIds }, edition: "default" },
  });
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: input.mediaIds } },
  });
  if (
    reservations > 0 ||
    intents.some(
      (intent) =>
        (!input.newTargetIds.has(intent.mediaId) &&
          intent.automationEpoch !== input.epoch) ||
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
    const claimed = await tx.mediaIntent.update({
      where: targetWhere(defaultScope(mediaId)),
      data: {
        desiredPresence: true,
        profileId: input.profileId,
        ...(input.newTargetIds.has(mediaId)
          ? {
              generation: 1,
              version: 0,
              automationEpoch: input.epoch,
              monitoring: true,
            }
          : {}),
      },
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
