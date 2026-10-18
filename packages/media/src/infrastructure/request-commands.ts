import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { ExpectedTarget } from "#shared/editions/commands.ts";
import { assertDefaultCommandCas } from "./editions/command-cas.ts";
import { lockCommandActor } from "./editions/command-actor.ts";
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
import { needsRestore } from "./locks.ts";
import { defaultScope, assertDefaultEdition } from "#shared/editions/scope.ts";
import { targetWhere } from "./editions/targets.ts";
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
  lockDefaultScopes,
} from "./editions/locks.ts";
import { commandAutomationEpoch } from "./handoff/authority.ts";
import { queueMediaSubtitleTargets } from "#automation/subtitles/queue.ts";

export class MediaRequestCommands extends MediaCommandBase {
  createRequest(actor: MediaActor, key: string, input: CreateRequest) {
    return this.command(actor, key, { kind: "request", input }, (db) =>
      this.requestWork(db, actor, input),
    );
  }

  protected async requestWork(
    db: Prisma.TransactionClient,
    actor: MediaActor,
    input: CreateRequest,
    expected?: ExpectedTarget,
  ) {
    const compensationGroup = await compensationGroupMedia(db, [input.mediaId]);
    await lockCanonicalMedia(db, compensationGroup);
    await lockExistingDefaultTargets(db, compensationGroup);
    await assertCompensationGroupUnchanged(
      db,
      [input.mediaId],
      compensationGroup,
    );
    if (expected !== undefined)
      await assertDefaultCommandCas(db, defaultScope(input.mediaId), expected);
    const targets = await lockDefaultScopes(db, [defaultScope(input.mediaId)], {
      createMissing: true,
    });
    const target = targets[0];
    if (target === undefined) throw new Error("Request target missing");
    if (target.target.lineage !== "resolved")
      throw new MediaError(
        "lineage_unresolved",
        "Canonical media ancestry requires reconciliation",
        409,
      );
    await lockEffectiveRequests(db, compensationGroup);
    const automationEpoch = await commandAutomationEpoch(db);
    const media = await db.mediaItem.findUnique({
      where: { id: input.mediaId },
    });
    if (!media)
      throw new MediaError("media_not_found", "Media item does not exist", 404);
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
      where: {
        userId_mediaId_edition: { userId, ...defaultScope(media.id) },
      },
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
      where: targetWhere(defaultScope(media.id)),
    });
    const profileId = prior?.profileId ?? defaults?.profileId ?? null;
    const intent = await db.mediaIntent.upsert({
      where: targetWhere(defaultScope(media.id)),
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
        version: target.existed ? { increment: 1 } : 0,
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
      (db) => this.cancelWork(db, actor, { requestId, expectedVersion }),
    );
  }

  protected async cancelWork(
    db: Prisma.TransactionClient,
    actor: MediaActor,
    options: {
      requestId: string;
      expectedVersion: number;
      context?: { mediaId: string; expected: ExpectedTarget };
    },
  ) {
    const { requestId, expectedVersion, context } = options;
    const request = await db.mediaRequest.findUnique({
      where: { id: requestId },
      include: { media: true },
    });
    if (!request)
      throw new MediaError("request_not_found", "Request does not exist", 404);
    if (context !== undefined && context.mediaId !== request.mediaId)
      throw new MediaError(
        "request_scope_conflict",
        "Request belongs to a different media target",
        409,
      );
    assertDefaultEdition(request.edition);
    await lockDefaultScopes(db, [defaultScope(request.mediaId)], {
      createMissing: false,
    });
    if (context !== undefined)
      await assertDefaultCommandCas(
        db,
        defaultScope(request.mediaId),
        context.expected,
      );
    await lockEffectiveRequests(db, [request.mediaId]);
    const currentActor = await lockCommandActor(db, actor);
    if (request.userId !== currentActor.id && currentActor.role !== "owner")
      throw new MediaError(
        "forbidden",
        "You can only cancel your own requests",
        403,
      );
    const changed = await db.mediaRequest.updateMany({
      where: { id: requestId, version: expectedVersion, active: true },
      data: {
        active: false,
        direct: false,
        excluded: true,
        ...(request.media.kind === "movie"
          ? {
              movieEditionChoiceId: null,
              movieEditionChoiceRevision: { increment: 1 },
            }
          : {}),
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
      where: targetWhere(defaultScope(request.mediaId)),
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
  }
}
import {
  compensationGroupMedia,
  assertCompensationGroupUnchanged,
} from "#infrastructure/native-compensation/routing.ts";
