import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { lockCommandActor } from "#infrastructure/editions/command-actor.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { invalidateRetention } from "#infrastructure/action-guards.ts";
import {
  RequestInterestCommandSchema,
  RequestInterestResultSchema,
  type RequestInterestCommand,
  LibraryKeepingCommandSchema,
  LibraryKeepingResultSchema,
  type LibraryKeepingCommand,
  InterestCheckNoticeSchema,
} from "#shared/household/interests.ts";
import { renewedInterest } from "./policy.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import type {
  MediaRequest,
  Prisma,
  MediaKind,
} from "#generated/prisma/client.ts";

export class RequestInterestCommands extends MediaCommandBase {
  libraryPolicy(actor: MediaActor, key: string, raw: LibraryKeepingCommand) {
    const input = LibraryKeepingCommandSchema.parse(raw);
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "library_keeping_policy", input },
        decode: (value) => LibraryKeepingResultSchema.parse(value),
      },
      async (tx) => {
        if (input.edition === "default")
          await lockDefaultScopes(
            tx,
            [{ mediaId: input.mediaId, edition: "default" }],
            { createMissing: false },
          );
        else
          await lockMovieCommand(tx, {
            rootMediaId: input.mediaId,
            mediaId: input.mediaId,
            edition: input.edition,
          });
        const currentActor = await lockCommandActor(tx, actor);
        if (currentActor.role !== "owner" || currentActor.restricted)
          throw new MediaError(
            "owner_required",
            "Only the owner can change library keeping policy",
            403,
          );
        const media = await tx.mediaItem.findUniqueOrThrow({
          where: { id: input.mediaId },
        });
        const target = await tx.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: { mediaId: input.mediaId, edition: input.edition },
          },
        });
        if (
          media.version !== input.expectedMediaVersion ||
          target.version !== input.expectedTargetVersion
        )
          throw new MediaError(
            "version_conflict",
            "Library policy changed; refresh before acting",
            409,
          );
        const updated = await tx.mediaIntent.update({
          where: {
            mediaId_edition: { mediaId: media.id, edition: input.edition },
          },
          data: {
            libraryKeep: input.keepingPolicy === "keep",
            libraryPolicyExplicit: true,
            libraryPolicyActorId: currentActor.id,
            version: { increment: 1 },
            generation: { increment: 1 },
          },
        });
        const item = await tx.mediaItem.update({
          where: { id: media.id },
          data: { version: { increment: 1 } },
        });
        await tx.retentionDecision.updateMany({
          where: {
            mediaId: media.id,
            edition: input.edition,
            state: { in: ["eligible", "warning_pending", "grace_period"] },
          },
          data: { state: "cancelled", version: { increment: 1 } },
        });
        await tx.applicationEvent.create({
          data: {
            mediaId: media.id,
            actorId: currentActor.id,
            kind: "library_keeping_policy_changed",
            payload: {
              edition: input.edition,
              keepingPolicy: input.keepingPolicy,
              targetVersion: updated.version,
            },
          },
        });
        return {
          schemaVersion: 1,
          mediaId: media.id,
          edition: input.edition,
          mediaVersion: item.version,
          targetVersion: updated.version,
          keepingPolicy: input.keepingPolicy,
        };
      },
    );
  }
  execute(actor: MediaActor, key: string, raw: RequestInterestCommand) {
    const input = RequestInterestCommandSchema.parse(raw);
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "request_interest", input },
        decode: (value) => RequestInterestResultSchema.parse(value),
      },
      async (tx) => {
        const initial = await tx.mediaRequest.findUnique({
          where: { id: input.requestId },
          include: { media: true },
        });
        if (initial === null)
          throw new MediaError(
            "request_not_found",
            "Request does not exist",
            404,
          );
        if (!initial.direct)
          throw new MediaError(
            "root_request_required",
            "Manage interest on the original request",
            409,
          );
        if (initial.media.kind === "movie")
          await lockMovieCommand(tx, {
            rootMediaId: initial.mediaId,
            mediaId: initial.mediaId,
            edition: MovieEditionKeySchema.parse(initial.edition),
          });
        else
          await lockDefaultScopes(
            tx,
            [{ mediaId: initial.mediaId, edition: "default" }],
            { createMissing: false },
          );
        const currentActor = await lockCommandActor(tx, actor);
        await tx.$queryRaw`SELECT id FROM "MediaRequest" WHERE id=${initial.id} FOR UPDATE`;
        const request = await tx.mediaRequest.findUniqueOrThrow({
          where: { id: initial.id },
        });
        validateInterestCommand(request, currentActor, input);
        const now = new Date();
        if (input.action === "notice_viewed") {
          await markInterestNoticeViewed(tx, {
            request,
            actor: currentActor,
            input,
            now,
          });
        } else {
          await this.changeInterest(tx, {
            actor: currentActor,
            request,
            kind: initial.media.kind,
            input,
            now,
          });
        }
        const changed = await tx.mediaRequest.findUniqueOrThrow({
          where: { id: request.id },
        });
        return {
          schemaVersion: 1,
          requestId: changed.id,
          version: changed.version,
          interestRevision: changed.interestRevision,
          state: changed.interestState,
          keepingPolicy: changed.keepingPolicy,
        };
      },
    );
  }

  private async changeInterest(
    tx: Prisma.TransactionClient,
    options: {
      actor: MediaActor;
      request: MediaRequest;
      kind: MediaKind;
      input: RequestInterestCommand;
      now: Date;
    },
  ) {
    const { actor, request, kind, input, now } = options;
    if (
      ["finished", "drop"].includes(input.action) &&
      request.keepingPolicy === "keep"
    )
      throw new MediaError(
        "keep_protected",
        "Make this request temporary before finishing it",
        409,
      );
    await tx.mediaRequest.update({
      where: { id: request.id },
      data: changedInterestData(input.action, now),
    });
    const target = await tx.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: request.mediaId, edition: request.edition },
      },
    });
    const updated = await tx.mediaIntent.update({
      where: {
        mediaId_edition: { mediaId: request.mediaId, edition: request.edition },
      },
      data: {
        generation: { increment: 1 },
        version: { increment: 1 },
        ...(["keep", "temporary"].includes(input.action)
          ? {
              libraryKeep: input.action === "keep",
              libraryPolicyExplicit: true,
              libraryPolicyActorId: actor.id,
            }
          : {}),
      },
    });
    await tx.mediaItem.update({
      where: { id: request.mediaId },
      data: { version: { increment: 1 } },
    });
    if (request.edition === "default")
      await invalidateRetention(tx, request.mediaId);
    else
      await tx.retentionDecision.updateMany({
        where: {
          mediaId: request.mediaId,
          edition: request.edition,
          state: { in: ["eligible", "warning_pending", "grace_period"] },
        },
        data: { state: "cancelled", version: { increment: 1 } },
      });
    if (request.edition === "default")
      await this.enqueue(tx, actor, {
        kind:
          kind === "series" || kind === "season"
            ? "expand_request"
            : "reconcile_media",
        mediaId: request.mediaId,
        generation: updated.generation,
        details: {
          requestId: request.id,
          requestVersion: request.version + 1,
          cursor: null,
          priorGeneration: target.generation,
        },
      });
    await tx.applicationEvent.create({
      data: {
        mediaId: request.mediaId,
        actorId: actor.id,
        kind: "request_interest_changed",
        payload: {
          requestId: request.id,
          subjectUserId: request.userId,
          action: input.action,
          interestRevision: request.interestRevision + 1,
        },
      },
    });
  }
}

function validateInterestCommand(
  request: MediaRequest,
  actor: MediaActor,
  input: RequestInterestCommand,
) {
  if (
    request.userId !== actor.id &&
    (actor.role !== "owner" || actor.restricted)
  )
    throw new MediaError(
      "forbidden",
      "You can only manage your own interest",
      403,
    );
  if (
    request.version !== input.expectedVersion ||
    request.interestRevision !== input.expectedInterestRevision
  )
    throw new MediaError(
      "version_conflict",
      "Interest changed; refresh before acting",
      409,
    );
  if (
    ["keep", "temporary"].includes(input.action) &&
    (actor.role !== "owner" || actor.restricted)
  )
    throw new MediaError(
      "owner_required",
      "Only the owner can change permanent keeping policy",
      403,
    );
}

function changedInterestData(
  action: RequestInterestCommand["action"],
  now: Date,
): Prisma.MediaRequestUpdateInput {
  const released = action === "finished" || action === "drop";
  return {
    ...renewedInterest(now),
    interestRevision: { increment: 1 },
    version: { increment: 1 },
    ...(action === "keep" ? { keepingPolicy: "keep" } : {}),
    ...(action === "temporary" ? { keepingPolicy: "temporary" } : {}),
    ...(released
      ? {
          interestState: action === "finished" ? "finished" : "dropped",
          interestReleasedAt: now,
          interestReleaseReason:
            action === "finished" ? "finished_manually" : "dropped_manually",
        }
      : {}),
  };
}

async function markInterestNoticeViewed(
  tx: Prisma.TransactionClient,
  options: {
    request: MediaRequest;
    actor: MediaActor;
    input: RequestInterestCommand;
    now: Date;
  },
) {
  const { request, actor, input, now } = options;
  if (
    request.userId !== actor.id ||
    request.interestState !== "following" ||
    request.keepingPolicy !== "temporary" ||
    request.interestNoticeEventId === null ||
    request.interestNoticeEventId !== input.noticeEventId ||
    request.interestNoticeRevision !== request.interestRevision
  )
    throw new MediaError(
      "notice_obsolete",
      "This interest notice no longer applies",
      409,
    );
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: request.interestNoticeEventId },
  });
  const notice = InterestCheckNoticeSchema.parse(event.payload);
  if (
    event.kind !== "interest_check" ||
    event.mediaId !== request.mediaId ||
    notice.requestId !== request.id ||
    notice.userId !== request.userId ||
    notice.mediaId !== request.mediaId ||
    notice.edition !== request.edition ||
    notice.interestRevision !== request.interestRevision
  )
    throw new MediaError(
      "notice_obsolete",
      "This interest notice no longer applies",
      409,
    );
  await tx.mediaRequest.update({
    where: { id: request.id },
    data: {
      interestNoticeViewedAt: request.interestNoticeViewedAt ?? now,
      interestNoticeAcceptedAt: request.interestNoticeAcceptedAt ?? now,
      version: { increment: 1 },
    },
  });
}
