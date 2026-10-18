import { assertDefaultFileEdition } from "#automation/files/editions/guard.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { defaultIntent } from "#shared/editions/scope.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { z } from "zod";
import {
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import { assertAttemptMovieChoice } from "#automation/editions/choice.ts";
import { currentFulfillmentAsset } from "#automation/editions/fulfillment.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { readMovieDemandAuthority } from "#infrastructure/movie-editions/fulfillment.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import {
  FileGuardError,
  GenerationsSchema,
  type Transaction,
  type FileContext,
  now,
} from "./types.ts";
import { assertOwnerRemoval } from "./owner-removal.ts";
import { assertAcquisitionIdentity } from "./acquisition-identity/guard.ts";
import { assertLegacySubmissionSponsor } from "#infrastructure/acquisition-identity/sponsor.ts";
import { MediaError } from "#application/errors.ts";
import { lockDefaultMedia } from "#infrastructure/handoff/default-edition.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import {
  effectiveRequestWhere,
  lockEffectiveRequests,
} from "#infrastructure/request-claims.ts";

/** Caller holds all affected MediaItem rows, shared with reservation creation. */
export async function assertNoMediaSubtitleReplacement(
  tx: Transaction,
  mediaIds: readonly string[],
) {
  const reserved = await tx.subtitleReplacement.findFirst({
    where: {
      reservationActive: true,
      asset: { coverage: { some: { mediaId: { in: [...mediaIds] } } } },
    },
  });
  if (reserved !== null)
    throw new FileGuardError("subtitle_replacement_unsettled");
}

export async function lockMedia(
  tx: Transaction,
  mediaIds: readonly string[],
): Promise<void> {
  if (mediaIds.length === 0) throw new FileGuardError("coverage_missing");
  try {
    await lockDefaultMedia(tx, mediaIds);
  } catch (error) {
    if (error instanceof MediaError) throw new FileGuardError(error.code);
    throw error;
  }
}

export async function assertRuntime(
  tx: Transaction,
  recoveryEpoch: number,
): Promise<void> {
  if (!(await lockRuntimeAuthority(tx, recoveryEpoch)))
    throw new FileGuardError("runtime_protected");
}

export async function assertAcquisition(
  tx: Transaction,
  attemptId: string,
  authority: {
    serverMachineId?: string | undefined;
    movieAccess?: MovieChoiceAccess | undefined;
  } = {},
) {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { reservations: true },
  });
  const epoch = z
    .object({ recoveryEpoch: z.number().int() })
    .parse(attempt).recoveryEpoch;
  await assertPublicationUnfenced(tx, attempt.mediaIds);
  if (
    attempt.edition !== "default" ||
    attempt.reservations.some((row) => row.edition !== "default")
  )
    throw new FileGuardError("edition_not_available");
  await lockEffectiveRequests(tx, attempt.mediaIds);
  await assertRuntime(tx, epoch);
  const choice =
    attempt.state === "imported"
      ? null
      : await assertAttemptMovieChoice(tx, attemptId, authority.movieAccess);
  if (attempt.state !== "imported") {
    try {
      await assertLegacySubmissionSponsor(tx, attempt, authority);
    } catch (error) {
      if (error instanceof MediaError) throw new FileGuardError(error.code);
      throw error;
    }
  }
  await assertNoMediaSubtitleReplacement(tx, attempt.mediaIds);
  const generations = GenerationsSchema.parse(attempt.generations);
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: attempt.mediaIds } },
  });
  if (
    intents.length !== attempt.mediaIds.length ||
    intents.some(
      (intent) =>
        !intent.desiredPresence ||
        intent.automationEpoch !== epoch ||
        intent.generation !== generations[intent.mediaId],
    )
  )
    throw new FileGuardError("intent_obsolete");
  const claimed = await tx.mediaRequest.findMany({
    where: { ...effectiveRequestWhere, mediaId: { in: attempt.mediaIds } },
    select: { mediaId: true },
  });
  if (
    attempt.mediaIds.some(
      (mediaId) => !claimed.some((request) => request.mediaId === mediaId),
    )
  )
    throw new FileGuardError("request_obsolete");
  if (
    attempt.reservations.length !== attempt.mediaIds.length ||
    attempt.reservations.some(
      (reservation) =>
        reservation.generation !== generations[reservation.mediaId],
    )
  )
    throw new FileGuardError("reservation_obsolete");
  if (["failed", "cancelled", "obsolete"].includes(attempt.state))
    throw new FileGuardError("attempt_obsolete");
  await assertAcquisitionIdentity(tx, attempt, authority);
  choice?.assertActive();
  return choice;
}

export async function assertRetention(input: {
  tx: Transaction;
  context: FileContext;
  decisionId: string;
  mediaIds: readonly string[];
  generations: Readonly<Record<string, number>>;
  purge: boolean;
  movieAccess?: MovieChoiceAccess | undefined;
}): Promise<MovieChoiceFreshness | null> {
  const { tx, context } = input;
  await assertPublicationUnfenced(tx, input.mediaIds);
  await assertNoMediaSubtitleReplacement(tx, input.mediaIds);
  await lockEffectiveRequests(tx, input.mediaIds);
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
  });
  assertDefaultFileEdition(decision.edition);
  if (decision.state !== (input.purge ? "quarantined" : "grace_period"))
    throw new FileGuardError("decision_obsolete");
  const evidence = z
    .object({
      authorizedAt: z.iso.datetime(),
      activePlayback: z.literal(false),
      recoveryEpoch: z.number().int(),
      warningEventId: z.string().optional(),
      ownerOverride: z.unknown().optional(),
    })
    .safeParse(decision.evidence);
  if (!evidence.success) throw new FileGuardError("evidence_missing");
  const timestamp = now(context).getTime();
  const age = timestamp - Date.parse(evidence.data.authorizedAt);
  if (age < 0 || age > 60_000) throw new FileGuardError("evidence_stale");
  await assertRuntime(tx, evidence.data.recoveryEpoch);
  await assertRetentionAuthority(
    tx,
    input.mediaIds,
    evidence.data.recoveryEpoch,
  );
  const due = input.purge ? decision.purgeAfter : decision.graceUntil;
  if (due === null || due.getTime() > timestamp)
    throw new FileGuardError("retention_not_due");
  if (input.purge) assertQuarantineElapsed(decision.quarantinedAt, timestamp);
  if (input.generations[decision.mediaId] !== decision.generation)
    throw new FileGuardError("decision_obsolete");
  if (evidence.data.ownerOverride !== undefined) {
    await assertOwnerRemoval({
      tx,
      evidence: evidence.data.ownerOverride,
      mediaIds: input.mediaIds,
      purge: input.purge,
    });
    return null;
  }
  if (evidence.data.warningEventId === undefined)
    throw new FileGuardError("warning_unconfirmed");
  await lockMovieChoiceIdentities(tx, { mediaIds: input.mediaIds });
  const guards: MovieChoiceFreshness[] = [];
  for (const mediaId of input.mediaIds) {
    const warning =
      mediaId === decision.mediaId
        ? {
            warningEventId: evidence.data.warningEventId,
            acceptedAt: decision.warningAcceptedAt,
          }
        : await coveredWarning({ ...input, mediaId, timestamp });
    assertWarningGrace(warning.acceptedAt, timestamp);
    const guard = await assertRetentionItem({
      tx,
      mediaId,
      generations: input.generations,
      timestamp,
      warningEventId: warning.warningEventId,
      movieAccess: input.movieAccess,
    });
    if (guard !== null) guards.push(guard);
  }
  const assertActive = () => {
    for (const guard of guards) guard.assertActive();
  };
  assertActive();
  return { assertActive };
}

function assertWarningGrace(acceptedAt: Date | null, timestamp: number) {
  if (acceptedAt === null || timestamp - acceptedAt.getTime() < 7 * 86_400_000)
    throw new FileGuardError("warning_grace_incomplete");
}

async function assertRetentionAuthority(
  tx: Transaction,
  mediaIds: readonly string[],
  epoch: number,
): Promise<void> {
  await assertLegacyClaimsResolved(tx, mediaIds);
  if (
    !(await recordsAuthorized(tx, {
      epoch,
      mediaIds,
    }))
  )
    throw new FileGuardError("record_ownership_unconfirmed");
  if (
    await tx.recoveryHold.count({
      where: {
        edition: "default",
        mediaId: { in: [...mediaIds] },
        releasedAt: null,
      },
    })
  )
    throw new FileGuardError("recovery_request_history_unconfirmed");
}

function assertQuarantineElapsed(
  quarantinedAt: Date | null,
  timestamp: number,
): void {
  if (
    quarantinedAt === null ||
    timestamp - quarantinedAt.getTime() < 7 * 86_400_000
  )
    throw new FileGuardError("quarantine_incomplete");
}

async function coveredWarning(input: {
  tx: Transaction;
  mediaId: string;
  generations: Readonly<Record<string, number>>;
  timestamp: number;
  purge: boolean;
}) {
  const { tx, mediaId, timestamp } = input;
  const generation = input.generations[mediaId];
  if (generation === undefined) throw new FileGuardError("coverage_missing");
  const covered = await tx.retentionDecision.findFirst({
    where: {
      edition: "default",
      mediaId,
      generation,
      state: input.purge ? "quarantined" : "grace_period",
    },
    orderBy: { createdAt: "desc" },
  });
  const coveredDue = input.purge ? covered?.purgeAfter : covered?.graceUntil;
  if (
    coveredDue === undefined ||
    coveredDue === null ||
    coveredDue.getTime() > timestamp
  )
    throw new FileGuardError("covered_media_protected");
  const proof = z
    .object({ warningEventId: z.string() })
    .safeParse(covered?.evidence);
  if (!proof.success) throw new FileGuardError("warning_unconfirmed");
  return {
    warningEventId: proof.data.warningEventId,
    acceptedAt: covered?.warningAcceptedAt ?? null,
  };
}

async function assertRetentionItem(input: {
  tx: Transaction;
  mediaId: string;
  generations: Readonly<Record<string, number>>;
  timestamp: number;
  warningEventId: string;
  movieAccess?: MovieChoiceAccess | undefined;
}) {
  const { tx, mediaId, generations, timestamp } = input;
  const item = await tx.mediaItem.findUniqueOrThrow({
    where: { id: mediaId },
    include: {
      intents: { where: { edition: "default" } },
      holds: { where: { edition: "default" } },
      requests: {
        where: {
          OR: [
            effectiveRequestWhere,
            {
              edition: { not: "default" },
              media: { kind: "movie" },
              active: true,
              excluded: false,
              direct: true,
            },
          ],
        },
        include: { user: true },
      },
      watchStates: { where: { edition: "default" } },
    },
  });
  if (defaultIntent(item.intents)?.generation !== generations[mediaId])
    throw new FileGuardError("intent_obsolete");
  if (
    item.holds.some(
      (hold) =>
        hold.isPin || hold.until === null || hold.until.getTime() > timestamp,
    )
  )
    throw new FileGuardError("retention_hold");
  const movie = await assertRetentionFulfillment(tx, {
    mediaId,
    kind: item.kind,
    movieAccess: input.movieAccess,
  });
  const requesters = item.requests.filter(
    (claim) => claim.edition === "default" && claim.user.role !== "owner",
  );
  if (requesters.length === 0)
    throw new FileGuardError("owner_only_or_unclaimed");
  for (const requester of requesters) {
    const watch = item.watchStates.find(
      (value) => value.userId === requester.userId,
    );
    if (
      watch === undefined ||
      !watch.watched ||
      timestamp - watch.observedAt.getTime() > 900_000 ||
      watch.observedAt.getTime() > timestamp
    )
      throw new FileGuardError("watch_unconfirmed");
    const accepted = await tx.notificationDelivery.findFirst({
      where: {
        eventId: input.warningEventId,
        userId: requester.userId,
        state: "accepted",
        channel: { in: ["email", "discord"] },
        OR: [{ providerStatus: null }, { providerStatus: { not: "bounced" } }],
        acceptedAt: { lte: new Date(timestamp - 7 * 86_400_000) },
        reconciledAt: {
          gte: new Date(timestamp - 60_000),
          lte: new Date(timestamp),
        },
        event: { mediaId },
      },
    });
    if (accepted === null) throw new FileGuardError("warning_unconfirmed");
  }
  const reservation = await tx.acquisitionReservation.findUnique({
    where: targetWhere(defaultScope(mediaId)),
  });
  if (reservation !== null) throw new FileGuardError("acquisition_active");
  movie?.freshness?.assertActive();
  return movie?.freshness ?? null;
}

async function assertRetentionFulfillment(
  tx: Transaction,
  input: {
    mediaId: string;
    kind: string;
    movieAccess: MovieChoiceAccess | undefined;
  },
) {
  const currentAsset = await currentFulfillmentAsset(tx, input.mediaId);
  const movie =
    input.kind === "movie"
      ? await readMovieDemandAuthority(tx, {
          mediaId: input.mediaId,
          currentAsset,
          access: requireMovieChoiceAccess(input.movieAccess ?? {}),
        })
      : null;
  for (const demand of movie?.demands ?? []) {
    if (demand.fulfillment.status !== "fulfilled")
      throw new FileGuardError(
        demand.fulfillment.reason ?? "movie_edition_choice_required",
      );
  }
  return movie;
}
