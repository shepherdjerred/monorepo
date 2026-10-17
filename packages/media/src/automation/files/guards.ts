import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  FileGuardError,
  GenerationsSchema,
  type Transaction,
  type FileContext,
  now,
} from "./types.ts";
import { assertOwnerRemoval } from "./owner-removal.ts";
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
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaItem" WHERE id IN (${Prisma.join([...new Set(mediaIds)].sort())}) ORDER BY id FOR UPDATE`,
  );
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
): Promise<void> {
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { reservations: true },
  });
  const epoch = z
    .object({ recoveryEpoch: z.number().int() })
    .parse(attempt).recoveryEpoch;
  await assertRuntime(tx, epoch);
  await assertNoMediaSubtitleReplacement(tx, attempt.mediaIds);
  const generations = GenerationsSchema.parse(attempt.generations);
  await lockEffectiveRequests(tx, attempt.mediaIds);
  const intents = await tx.mediaIntent.findMany({
    where: { mediaId: { in: attempt.mediaIds } },
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
}

export async function assertRetention(input: {
  tx: Transaction;
  context: FileContext;
  decisionId: string;
  mediaIds: readonly string[];
  generations: Readonly<Record<string, number>>;
  purge: boolean;
}): Promise<void> {
  const { tx, context } = input;
  await assertNoMediaSubtitleReplacement(tx, input.mediaIds);
  await lockEffectiveRequests(tx, input.mediaIds);
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
  });
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
    return;
  }
  if (evidence.data.warningEventId === undefined)
    throw new FileGuardError("warning_unconfirmed");
  for (const mediaId of input.mediaIds) {
    const warning =
      mediaId === decision.mediaId
        ? {
            warningEventId: evidence.data.warningEventId,
            acceptedAt: decision.warningAcceptedAt,
          }
        : await coveredWarning({ ...input, mediaId, timestamp });
    if (
      warning.acceptedAt === null ||
      timestamp - warning.acceptedAt.getTime() < 7 * 86_400_000
    )
      throw new FileGuardError("warning_grace_incomplete");
    await assertRetentionItem({
      tx,
      mediaId,
      generations: input.generations,
      timestamp,
      warningEventId: warning.warningEventId,
    });
  }
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
      where: { mediaId: { in: [...mediaIds] }, releasedAt: null },
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
}): Promise<void> {
  const { tx, mediaId, generations, timestamp } = input;
  const item = await tx.mediaItem.findUniqueOrThrow({
    where: { id: mediaId },
    include: {
      intent: true,
      holds: true,
      requests: { where: effectiveRequestWhere, include: { user: true } },
      watchStates: true,
    },
  });
  if (item.intent?.generation !== generations[mediaId])
    throw new FileGuardError("intent_obsolete");
  if (
    item.holds.some(
      (hold) =>
        hold.isPin || hold.until === null || hold.until.getTime() > timestamp,
    )
  )
    throw new FileGuardError("retention_hold");
  const requesters = item.requests.filter(
    (claim) => claim.user.role !== "owner",
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
    where: { mediaId },
  });
  if (reservation !== null) throw new FileGuardError("acquisition_active");
}
