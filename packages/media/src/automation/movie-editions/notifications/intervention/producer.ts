import { z } from "zod";
import type { Operation, Prisma } from "#generated/prisma/client.ts";
import {
  MovieInterventionNoticeV4Schema,
  type MovieInterventionNoticeV4,
} from "#shared/movie-editions/intervention/v4.ts";
import { movieInterventionCommand } from "./source.ts";
import { queueDelivery } from "#automation/notifications/events.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";

/** Actual failure transaction queues scoped personal and owner notices without claiming serving authority. */
export async function queueMovieInterventionV4(
  tx: Prisma.TransactionClient,
  operation: Operation,
  attemptId?: string,
) {
  const original = movieInterventionCommand(operation);
  const failure = MovieInterventionNoticeV4Schema.shape.failure.parse({
    status: operation.status,
    reason:
      z
        .object({ reason: z.string().nullable().optional() })
        .nullable()
        .parse(operation.result)?.reason ?? null,
  });
  const { target } = await lockMovieCommand(tx, original.source.scope);
  if (
    target?.generation !== original.source.generation ||
    target.automationEpoch !== original.recoveryEpoch
  )
    return;
  const draft = {
    schemaVersion: 4 as const,
    kind: "movie_intervention" as const,
    ...original,
    failure,
    ...(attemptId === undefined ? {} : { attemptId }),
  };
  const reconciliationKey = repeatedReconciliationKey(operation, draft);
  const requests = await tx.mediaRequest.findMany({
    where: {
      mediaId: original.source.mediaId,
      edition: original.source.scope.edition,
      active: true,
      excluded: false,
      direct: true,
    },
    include: { movieEditionChoice: true },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (requests.length > 100)
    throw new Error("Movie intervention exceeds its recipient scope");
  const personalRecipients = new Set<string>();
  for (const request of requests) {
    const choice = request.movieEditionChoice;
    if (choice === null) continue;
    if (
      choice.requestId !== request.id ||
      choice.subjectUserId !== request.userId ||
      choice.choiceRevision !== request.movieEditionChoiceRevision ||
      choice.rootMediaId !== original.source.mediaId ||
      choice.edition !== original.source.scope.edition
    )
      throw new Error(
        "Movie intervention request choice changed its literal scope",
      );
    const queued = await queueRecipient(
      tx,
      MovieInterventionNoticeV4Schema.parse({
        ...draft,
        eventKind: "acquisition_failed",
        recipient: {
          kind: "personal",
          userId: request.userId,
          requestId: request.id,
          choiceId: choice.id,
          choiceRevision: choice.choiceRevision,
        },
      }),
      choice.actorId,
      reconciliationKey,
    );
    if (queued) personalRecipients.add(request.userId);
  }
  const owners = await tx.mediaUser.findMany({
    where: { role: "owner", restricted: false },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (owners.length > 100)
    throw new Error("Movie intervention exceeds its owner scope");
  for (const owner of owners) {
    if (personalRecipients.has(owner.id)) continue;
    await queueRecipient(
      tx,
      MovieInterventionNoticeV4Schema.parse({
        ...draft,
        eventKind: "system_intervention",
        recipient: { kind: "owner", userId: owner.id },
      }),
      null,
      reconciliationKey,
    );
  }
}

function repeatedReconciliationKey(
  operation: Pick<Operation, "kind" | "payload">,
  notice: Pick<
    MovieInterventionNoticeV4,
    "source" | "recoveryEpoch" | "failure" | "attemptId"
  >,
) {
  if (
    notice.attemptId !== undefined ||
    operation.kind !== "reconcile_movie_edition_v4"
  )
    return;
  const retries = z
    .object({
      movieRetryV1: z.unknown().optional(),
      movieRetryV2: z.unknown().optional(),
      movieRetryPlexAckV1: z.unknown().optional(),
    })
    .parse(operation.payload);
  if (Object.values(retries).some((retry) => retry !== undefined)) return;
  return identityHash({
    scope: notice.source.scope,
    generation: notice.source.generation,
    recoveryEpoch: notice.recoveryEpoch,
    failure: notice.failure,
  });
}

async function queueRecipient(
  tx: Prisma.TransactionClient,
  payload: MovieInterventionNoticeV4,
  actorId: string | null,
  reconciliationKey: string | undefined,
) {
  const user = await tx.mediaUser.findUniqueOrThrow({
    where: { id: payload.recipient.userId },
    include: { notificationPreference: true },
  });
  const preference = user.notificationPreference;
  if (
    preference === null ||
    user.restricted ||
    (!preference.emailEnabled && !preference.discordEnabled)
  )
    return false;
  const dedupeKey =
    reconciliationKey === undefined
      ? `movie-intervention-v4:${payload.source.operationId}:${payload.recipient.kind}:${payload.recipient.userId}`
      : `movie-reconciliation-intervention-v4:${reconciliationKey}:${identityHash(payload.recipient)}`;
  const event = await tx.applicationEvent.upsert({
    where: { dedupeKey },
    create: {
      dedupeKey,
      mediaId: payload.source.mediaId,
      actorId,
      kind: payload.eventKind,
      payload: z.record(z.string(), z.json()).parse(payload),
    },
    update: {},
  });
  for (const channel of ["email", "discord"] as const) {
    if (
      !(channel === "email"
        ? preference.emailEnabled
        : preference.discordEnabled)
    )
      continue;
    const delivery = await tx.notificationDelivery.upsert({
      where: {
        eventId_userId_channel: {
          eventId: event.id,
          userId: payload.recipient.userId,
          channel,
        },
      },
      create: {
        eventId: event.id,
        userId: payload.recipient.userId,
        channel,
        state: "pending",
        recoveryEpoch: payload.recoveryEpoch,
      },
      update: {},
    });
    await queueDelivery(
      tx,
      delivery.id,
      payload.recipient.userId,
      `notification:${delivery.id}`,
    );
  }
  return true;
}
