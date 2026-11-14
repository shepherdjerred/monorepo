import type { Database } from "#infrastructure/database.ts";
import type {
  MediaRequest,
  MediaKind,
  Prisma,
} from "#generated/prisma/client.ts";
import {
  evaluateRequestInterest,
  type InterestEvaluation,
} from "#domain/household/interests.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";
import { queueOperation } from "#automation/store.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { nativeInterestFacts } from "./facts.ts";
import { noticeAcceptance } from "./acceptance.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

/** One Temporal activity page, not a timer or a broad all-library transaction. */
export async function reconcileRequestInterests(
  db: Database,
  input: {
    cursor: string | null;
    now?: Date;
    refreshNotice?: (eventId: string) => Promise<boolean>;
  },
): Promise<{ processed: number; nextCursor: string | null }> {
  const requests = await db.mediaRequest.findMany({
    where: {
      direct: true,
      active: true,
      excluded: false,
      keepingPolicy: "temporary",
      interestState: "following",
      ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
    },
    orderBy: { id: "asc" },
    take: 1,
    select: { id: true, interestNoticeEventId: true },
  });
  for (const snapshot of requests) {
    // Providers are queried before locks. The transaction still rechecks exact
    // event/revision, recipient and reconciledAt, so a concurrent renewal wins.
    if (
      snapshot.interestNoticeEventId !== null &&
      input.refreshNotice !== undefined
    )
      await input.refreshNotice(snapshot.interestNoticeEventId);
    const now = input.now ?? new Date();
    await db.$transaction(
      async (tx) => {
        const initial = await tx.mediaRequest.findUniqueOrThrow({
          where: { id: snapshot.id },
          include: { media: true },
        });
        if (initial.media.kind === "movie")
          await lockMovieCommand(tx, {
            mediaId: initial.mediaId,
            rootMediaId: initial.mediaId,
            edition: MovieEditionKeySchema.parse(initial.edition),
          });
        else
          await lockDefaultScopes(
            tx,
            [{ mediaId: initial.mediaId, edition: "default" }],
            { createMissing: false },
          );
        await tx.$queryRaw`SELECT id FROM "MediaRequest" WHERE id=${initial.id} FOR UPDATE`;
        const request = await tx.mediaRequest.findUniqueOrThrow({
          where: { id: initial.id },
        });
        if (
          !request.active ||
          request.excluded ||
          !request.direct ||
          request.keepingPolicy !== "temporary" ||
          request.interestState !== "following"
        )
          return;
        const facts = await nativeInterestFacts(tx, request, now);
        if (await advanceProgress(tx, request, facts, now)) return;
        const acceptance = await noticeAcceptance(tx, request, now);
        const evaluation = evaluateRequestInterest({
          now: now.getTime(),
          kind: initial.media.kind,
          policy: request.keepingPolicy,
          state: request.interestState,
          revision: request.interestRevision,
          renewedAt: request.interestRenewedAt.getTime(),
          usableUnwatchedSince: request.usableUnwatchedSince?.getTime() ?? null,
          lastProgressAt: request.lastMeaningfulProgressAt?.getTime() ?? null,
          usableUnwatched: facts.usableUnwatched,
          watchedComplete: facts.watchedComplete,
          requestedCoverageComplete: facts.requestedCoverageComplete,
          terminalStatus: facts.terminalStatus,
          terminalObservedAt: facts.terminalObservedAt,
          notice:
            request.interestNoticeEventId === null
              ? null
              : {
                  revision: request.interestNoticeRevision ?? -1,
                  acceptedAt: acceptance?.getTime() ?? null,
                  failed: acceptance === null,
                },
        });
        await applyEvaluation(tx, {
          request,
          kind: initial.media.kind,
          evaluation,
          acceptance,
          now,
        });
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  }
  return {
    processed: requests.length,
    nextCursor: requests.at(-1)?.id ?? null,
  };
}

async function advanceProgress(
  tx: Prisma.TransactionClient,
  request: MediaRequest,
  facts: Awaited<ReturnType<typeof nativeInterestFacts>>,
  now: Date,
) {
  if (
    facts.progressAt === null ||
    facts.progressAt <= (request.lastMeaningfulProgressAt?.getTime() ?? 0)
  )
    return false;
  await tx.mediaRequest.update({
    where: { id: request.id },
    data: {
      lastMeaningfulProgressAt: new Date(facts.progressAt),
      usableUnwatchedSince: facts.usableUnwatched ? now : null,
      interestNoticeEventId: null,
      interestNoticeRevision: null,
      interestNoticeAcceptedAt: null,
      interestNoticeViewedAt: null,
      interestRevision: { increment: 1 },
      version: { increment: 1 },
    },
  });
  return true;
}

async function applyEvaluation(
  tx: Prisma.TransactionClient,
  options: {
    request: MediaRequest;
    kind: MediaKind;
    evaluation: InterestEvaluation;
    acceptance: Date | null;
    now: Date;
  },
) {
  const { request, kind, evaluation, acceptance, now } = options;
  if (evaluation.state === "protected") {
    if (
      evaluation.resetUsableClock &&
      (request.usableUnwatchedSince !== null ||
        request.interestNoticeEventId !== null)
    )
      await tx.mediaRequest.update({
        where: { id: request.id },
        data: {
          usableUnwatchedSince: null,
          interestNoticeEventId: null,
          interestNoticeRevision: null,
          interestNoticeAcceptedAt: null,
          interestNoticeViewedAt: null,
          interestRevision: { increment: 1 },
          version: { increment: 1 },
        },
      });
    return;
  }
  if (evaluation.state === "release")
    return releaseInterest(tx, { request, kind, evaluation, now });
  await tx.mediaRequest.update({
    where: { id: request.id },
    data: {
      usableUnwatchedSince: new Date(evaluation.usableSince),
      interestNoticeAcceptedAt: acceptance,
    },
  });
  if (
    evaluation.state === "notice_pending" &&
    request.interestNoticeEventId === null
  )
    await queueInterestNotice(tx, request, now);
}

async function releaseInterest(
  tx: Prisma.TransactionClient,
  options: {
    request: MediaRequest;
    kind: MediaKind;
    evaluation: Extract<InterestEvaluation, { state: "release" }>;
    now: Date;
  },
) {
  const { request, kind, evaluation, now } = options;
  const changed = await tx.mediaRequest.update({
    where: { id: request.id },
    data: {
      interestState: evaluation.stateAfter,
      interestReleasedAt: now,
      interestReleaseReason: evaluation.reason,
      interestRevision: { increment: 1 },
      version: { increment: 1 },
    },
  });
  const target = await tx.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: request.mediaId, edition: request.edition },
    },
    data: { generation: { increment: 1 }, version: { increment: 1 } },
  });
  await tx.mediaItem.update({
    where: { id: request.mediaId },
    data: { version: { increment: 1 } },
  });
  await tx.applicationEvent.create({
    data: {
      mediaId: request.mediaId,
      kind: "request_interest_released",
      payload: {
        requestId: request.id,
        userId: request.userId,
        interestRevision: changed.interestRevision,
        reason: evaluation.reason,
      },
    },
  });
  if (request.edition === "default")
    await queueOperation(tx, {
      key: `interest-release:${request.id}:${String(changed.interestRevision)}`,
      kind:
        kind === "series" || kind === "season"
          ? "expand_request"
          : "retain_media",
      targetId: request.mediaId,
      userId: request.userId,
      payload: {
        mediaId: request.mediaId,
        generation: target.generation,
        requestId: request.id,
        requestVersion: changed.version,
        cursor: null,
      },
    });
}

async function queueInterestNotice(
  tx: Prisma.TransactionClient,
  request: MediaRequest,
  now: Date,
) {
  const user = await tx.mediaUser.findUniqueOrThrow({
    where: { id: request.userId },
    include: { notificationPreference: true },
  });
  const event = await tx.applicationEvent.create({
    data: {
      mediaId: request.mediaId,
      kind: "interest_check",
      payload: InterestCheckNoticeSchema.parse({
        schemaVersion: 1,
        requestId: request.id,
        userId: request.userId,
        interestRevision: request.interestRevision,
        mediaId: request.mediaId,
        edition: request.edition,
      }),
    },
  });
  await tx.mediaRequest.update({
    where: { id: request.id },
    data: {
      interestNoticeEventId: event.id,
      interestNoticeRevision: request.interestRevision,
      interestNoticeAcceptedAt: null,
      interestNoticeViewedAt: null,
      version: { increment: 1 },
    },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const preference = user.notificationPreference;
  const channels = [
    preference?.emailEnabled === true &&
    user.emailVerifiedAt !== null &&
    user.email !== null
      ? "email"
      : null,
    preference?.discordEnabled === true && user.discordId !== null
      ? "discord"
      : null,
  ].filter((channel) => channel !== null);
  for (const channel of channels) {
    const delivery = await tx.notificationDelivery.create({
      data: {
        eventId: event.id,
        userId: user.id,
        channel,
        state: "pending",
        recoveryEpoch: runtime.recoveryEpoch,
      },
    });
    await queueOperation(tx, {
      key: `notification:${delivery.id}`,
      kind: "deliver_notification",
      targetId: delivery.id,
      userId: user.id,
      payload: { notificationId: delivery.id },
    });
  }
  if (channels.length === 0)
    await tx.applicationEvent.create({
      data: {
        mediaId: request.mediaId,
        kind: "interest_notice_needs_owner_attention",
        createdAt: now,
        payload: {
          requestId: request.id,
          userId: request.userId,
          noticeEventId: event.id,
          reason: "verified_private_channel_missing",
        },
      },
    });
}
