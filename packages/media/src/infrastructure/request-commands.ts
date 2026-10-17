import type { MediaActor } from "#application/auth.ts";
import { z } from "zod";
import { MediaError } from "#application/errors.ts";
import type { CreateRequest } from "#shared/contract.ts";
import { MediaCommandBase } from "./command-base.ts";
import { authorizeRequester } from "./requester-authorization.ts";
import {
  effectiveRequestWhere,
  lockEffectiveRequests,
} from "./request-claims.ts";
import { invalidateRetention } from "./action-guards.ts";
import { lockMedia, needsRestore } from "./locks.ts";
import { commandAutomationEpoch } from "./handoff/authority.ts";
import { queueMediaSubtitleTargets } from "#automation/subtitles/queue.ts";

export class MediaRequestCommands extends MediaCommandBase {
  createRequest(actor: MediaActor, key: string, input: CreateRequest) {
    return this.command(actor, key, { kind: "request", input }, async (db) => {
      await lockMedia(db, [input.mediaId]);
      await lockEffectiveRequests(db, [input.mediaId]);
      const automationEpoch = await commandAutomationEpoch(db);
      const media = await db.mediaItem.findUnique({
        where: { id: input.mediaId },
      });
      if (!media)
        throw new MediaError(
          "media_not_found",
          "Media item does not exist",
          404,
        );
      const userId = input.requesterUserId ?? actor.id;
      const { plexSectionId } = z
        .object({ plexSectionId: z.string().min(1).optional() })
        .parse(media.externalIds);
      await authorizeRequester(db, actor, userId, {
        ...this.settings,
        kind: media.kind,
        ...(plexSectionId === undefined ? {} : { sectionId: plexSectionId }),
      });
      if (input.includeFutureEpisodes === true && media.kind !== "series")
        throw new MediaError(
          "invalid_request_scope",
          "Future episodes require a series",
          422,
        );
      const options = {
        subtitleLanguages: input.subtitleLanguages,
        includeSpecials: input.includeSpecials,
        includeFutureEpisodes:
          input.includeFutureEpisodes ?? media.kind === "series",
      };
      const request = await db.mediaRequest.upsert({
        where: { userId_mediaId: { userId, mediaId: media.id } },
        create: { userId, mediaId: media.id, ...options },
        update: {
          ...options,
          direct: true,
          excluded: false,
          active: true,
          coverageCompletedAt: null,
          version: { increment: 1 },
        },
      });
      const defaults = await db.qualityProfileDefault.findUnique({
        where: { kind: media.kind === "movie" ? "movie" : "series" },
      });
      const prior = await db.mediaIntent.findUnique({
        where: { mediaId: media.id },
      });
      const profileId = prior?.profileId ?? defaults?.profileId ?? null;
      const intent = await db.mediaIntent.upsert({
        where: { mediaId: media.id },
        create: {
          mediaId: media.id,
          generation: 1,
          profileId,
          automationEpoch,
        },
        update: {
          automationEpoch,
          desiredPresence: true,
          monitoring: true,
          intentionallyRemovedAt: null,
          profileId,
          generation: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await db.mediaItem.update({
        where: { id: media.id },
        data: { version: { increment: 1 } },
      });
      await invalidateRetention(db, media.id);
      await queueMediaSubtitleTargets(db, media.id);
      const container = media.kind === "series" || media.kind === "season";
      const restore = !container && (await needsRestore(db, media.id));
      const operationId = await this.enqueue(db, actor, {
        kind: container
          ? "expand_request"
          : restore
            ? "restore_media"
            : "reconcile_media",
        mediaId: media.id,
        generation: intent.generation,
        details: {
          requestId: request.id,
          requestVersion: request.version,
          cursor: null,
        },
      });
      await db.applicationEvent.create({
        data: {
          mediaId: media.id,
          actorId: actor.id,
          kind: "request_created",
          payload: {
            requestId: request.id,
            requesterUserId: userId,
            expansionPending: container,
          },
        },
      });
      return {
        requestId: request.id,
        mediaId: media.id,
        operationId,
        status: "queued",
      };
    });
  }

  cancelRequest(
    actor: MediaActor,
    key: string,
    requestId: string,
    expectedVersion: number,
  ) {
    return this.command(
      actor,
      key,
      { kind: "cancel_request", input: { requestId, expectedVersion } },
      async (db) => {
        const request = await db.mediaRequest.findUnique({
          where: { id: requestId },
          include: { media: true },
        });
        if (!request)
          throw new MediaError(
            "request_not_found",
            "Request does not exist",
            404,
          );
        if (request.userId !== actor.id && actor.role !== "owner")
          throw new MediaError(
            "forbidden",
            "You can only cancel your own requests",
            403,
          );
        await lockMedia(db, [request.mediaId]);
        const changed = await db.mediaRequest.updateMany({
          where: { id: requestId, version: expectedVersion, active: true },
          data: {
            active: false,
            direct: false,
            excluded: true,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new MediaError(
            "version_conflict",
            "Request changed; refresh before cancelling",
            409,
          );
        const remaining = await db.mediaRequest.count({
          where: { mediaId: request.mediaId, ...effectiveRequestWhere },
        });
        await db.mediaItem.update({
          where: { id: request.mediaId },
          data: { version: { increment: 1 } },
        });
        const intent = await db.mediaIntent.update({
          where: { mediaId: request.mediaId },
          data: {
            generation: { increment: 1 },
            version: { increment: 1 },
            ...(remaining === 0 ? { monitoring: false } : {}),
          },
        });
        await invalidateRetention(db, request.mediaId);
        const container =
          request.media.kind === "series" || request.media.kind === "season";
        const operationId = await this.enqueue(db, actor, {
          kind: container ? "expand_request" : "reconcile_media",
          mediaId: request.mediaId,
          generation: intent.generation,
          details: {
            requestId,
            requestVersion: expectedVersion + 1,
            cursor: null,
          },
        });
        await db.applicationEvent.create({
          data: {
            mediaId: request.mediaId,
            actorId: actor.id,
            kind: "request_cancelled",
            payload: { requestId },
          },
        });
        return { requestId, operationId, status: "queued" };
      },
    );
  }
}
