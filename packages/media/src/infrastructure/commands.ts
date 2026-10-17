import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { CreateRequest, MediaAction } from "#shared/contract.ts";
import type { SaveQualityProfile } from "#shared/api.ts";
import {
  invalidateRetention,
  validateAction,
  applyHold,
  actionIntentChange,
  actionCommand,
  sponsorClaim,
} from "./action-guards.ts";
import { lockMedia, needsRestore } from "./locks.ts";
import { confirmRemoval } from "./removal-confirmation.ts";

import { MediaCommandBase } from "./command-base.ts";
export class PrismaMediaCommands extends MediaCommandBase {
  async createRequest(actor: MediaActor, key: string, input: CreateRequest) {
    return this.command(actor, key, { kind: "request", input }, async (db) => {
      const user = await db.mediaUser.findUniqueOrThrow({
        where: { id: actor.id },
      });
      if (user.restricted)
        throw new MediaError(
          "requests_restricted",
          "This account cannot create requests",
          403,
        );
      const media = await db.mediaItem.findUnique({
        where: { id: input.mediaId },
      });
      if (!media)
        throw new MediaError(
          "media_not_found",
          "Media item does not exist",
          404,
        );
      if (input.includeFutureEpisodes === true && media.kind !== "series")
        throw new MediaError(
          "invalid_request_scope",
          "Future episodes can only be requested for a series",
          422,
        );
      const includeFutureEpisodes =
        input.includeFutureEpisodes ?? media.kind === "series";
      const children =
        media.kind === "series"
          ? await db.mediaItem.findMany({
              where: {
                OR: [
                  { parentId: media.id, kind: "episode" },
                  { parent: { parentId: media.id }, kind: "episode" },
                ],
              },
            })
          : media.kind === "season"
            ? await db.mediaItem.findMany({
                where: { parentId: media.id, kind: "episode" },
              })
            : [];
      const covered = [
        media,
        ...children.filter(
          (child) => input.includeSpecials || child.seasonNumber !== 0,
        ),
      ];
      await lockMedia(
        db,
        covered.map((item) => item.id),
      );
      const root = await db.mediaRequest.upsert({
        where: { userId_mediaId: { userId: actor.id, mediaId: media.id } },
        create: { userId: actor.id, ...input, includeFutureEpisodes },
        update: {
          active: true,
          subtitleLanguages: input.subtitleLanguages,
          includeFutureEpisodes,
          includeSpecials: input.includeSpecials,
          version: { increment: 1 },
        },
      });
      let firstOperationId = "";
      for (const item of covered) {
        if (item.id !== media.id) {
          await sponsorClaim(db, actor.id, root.id, {
            mediaId: item.id,
            subtitleLanguages: input.subtitleLanguages,
          });
        }
        const intent = await db.mediaIntent.upsert({
          where: { mediaId: item.id },
          create: { mediaId: item.id, generation: 1 },
          update: {
            desiredPresence: true,
            monitoring: true,
            intentionallyRemovedAt: null,
            generation: { increment: 1 },
            version: { increment: 1 },
          },
        });
        await db.mediaItem.update({
          where: { id: item.id },
          data: { version: { increment: 1 } },
        });
        await invalidateRetention(db, item.id);
        const operationId = await this.enqueue(db, actor, {
          kind:
            item.availability === "quarantined" ||
            (await needsRestore(db, item.id))
              ? "restore_media"
              : "reconcile_media",
          mediaId: item.id,
          generation: intent.generation,
          details: { requestId: root.id },
        });
        if (!firstOperationId) firstOperationId = operationId;
      }
      await db.applicationEvent.create({
        data: {
          mediaId: media.id,
          actorId: actor.id,
          kind: "request_created",
          payload: {
            requestId: root.id,
            coveredMediaIds: covered.map((item) => item.id),
          },
        },
      });
      return {
        requestId: root.id,
        mediaId: media.id,
        operationId: firstOperationId,
        status: "queued",
      };
    });
  }

  async cancelRequest(
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
        const sponsored = await db.mediaRequest.findMany({
          where: { sponsorRequestId: requestId, active: true },
        });
        await lockMedia(db, [
          request.mediaId,
          ...sponsored.map((child) => child.mediaId),
        ]);
        const updated = await db.mediaRequest.updateMany({
          where: { id: requestId, version: expectedVersion, active: true },
          data: { active: false, version: { increment: 1 } },
        });
        if (updated.count !== 1)
          throw new MediaError(
            "version_conflict",
            "Request changed; refresh before cancelling",
            409,
          );
        await db.mediaRequest.updateMany({
          where: { sponsorRequestId: requestId, active: true },
          data: { active: false, version: { increment: 1 } },
        });
        for (const mediaId of new Set([
          request.mediaId,
          ...sponsored.map((child) => child.mediaId),
        ])) {
          const remaining = await db.mediaRequest.count({
            where: { mediaId, active: true },
          });
          await db.mediaItem.update({
            where: { id: mediaId },
            data: { version: { increment: 1 } },
          });
          const intent = await db.mediaIntent.update({
            where: { mediaId },
            data: {
              generation: { increment: 1 },
              version: { increment: 1 },
              ...(remaining === 0 ? { monitoring: false } : {}),
            },
          });
          await invalidateRetention(db, mediaId);
          await this.enqueue(db, actor, {
            kind: "reconcile_media",
            mediaId,
            generation: intent.generation,
          });
        }
        await db.applicationEvent.create({
          data: {
            mediaId: request.mediaId,
            actorId: actor.id,
            kind: "request_cancelled",
            payload: { requestId },
          },
        });
        return { requestId, status: "completed" };
      },
    );
  }

  async act(
    actor: MediaActor,
    key: string,
    mediaId: string,
    input: MediaAction,
  ) {
    if (["pin", "unpin", "remove", "select_release"].includes(input.action))
      requireOwner(actor);
    return this.command(
      actor,
      key,
      { kind: "media_action", input: { mediaId, ...input } },
      async (db) => {
        const removal =
          input.action === "remove"
            ? await confirmRemoval(db, mediaId, input)
            : null;
        await lockMedia(db, [mediaId]);
        await validateAction(db, actor, mediaId, input);
        const updated = await db.mediaItem.updateMany({
          where: { id: mediaId, version: input.expectedVersion },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1)
          throw new MediaError(
            "version_conflict",
            "Media changed; refresh before continuing",
            409,
          );
        await applyHold(db, actor, mediaId, {
          action: input.action,
          keepDays: this.settings.keepDays,
        });
        await invalidateRetention(db, mediaId);
        const intent = await db.mediaIntent.upsert({
          where: { mediaId },
          create: {
            mediaId,
            generation: 1,
            desiredPresence: input.action !== "remove",
            monitoring: input.action !== "remove",
            intentionallyRemovedAt:
              input.action === "remove" ? new Date() : null,
          },
          update: {
            generation: { increment: 1 },
            version: { increment: 1 },
            ...actionIntentChange(input.action),
          },
        });
        const kind =
          (input.action === "keep" || input.action === "pin") &&
          (await needsRestore(db, mediaId))
            ? "restore_media"
            : actionCommand(input.action);
        if (removal !== null) {
          for (const item of removal.media) {
            if (item.id === mediaId) continue;
            await db.mediaItem.update({
              where: { id: item.id },
              data: { version: { increment: 1 } },
            });
            await db.mediaIntent.update({
              where: { mediaId: item.id },
              data: {
                desiredPresence: false,
                monitoring: false,
                intentionallyRemovedAt: new Date(),
                generation: { increment: 1 },
                version: { increment: 1 },
              },
            });
            await invalidateRetention(db, item.id);
          }
        }
        const ownerOverride =
          removal === null
            ? {}
            : {
                ownerOverride: {
                  ownerId: actor.id,
                  media: removal.media.map((item) => ({
                    ...item,
                    version: item.version + 1,
                    generation: item.generation + 1,
                  })),
                  assets: removal.assets,
                },
              };
        const operationId = await this.enqueue(db, actor, {
          kind,
          mediaId,
          generation: intent.generation,
          details: {
            action: input.action,
            ...ownerOverride,
            ...(input.action === "select_release"
              ? { releaseId: input.releaseId }
              : {}),
          },
        });
        await db.applicationEvent.create({
          data: {
            mediaId,
            actorId: actor.id,
            kind: `media_${input.action}`,
            payload: { operationId, generation: intent.generation },
          },
        });
        return {
          operationId,
          status: "queued",
          version: input.expectedVersion + 1,
        };
      },
    );
  }

  async restrictUser(
    actor: MediaActor,
    key: string,
    userId: string,
    input: { expectedVersion: number; restricted: boolean },
  ) {
    const { expectedVersion, restricted } = input;
    requireOwner(actor);
    if (actor.id === userId)
      throw new MediaError(
        "owner_restriction",
        "The owner cannot restrict their own account",
        422,
      );
    return this.command(
      actor,
      key,
      { kind: "restrict_user", input: { userId, expectedVersion, restricted } },
      async (db) => {
        const changed = await db.mediaUser.updateMany({
          where: { id: userId, version: expectedVersion, role: "member" },
          data: { restricted, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new MediaError(
            "version_conflict",
            "User changed or does not exist",
            409,
          );
        return { userId, restricted, version: expectedVersion + 1 };
      },
    );
  }

  saveProfile(actor: MediaActor, key: string, input: SaveQualityProfile) {
    requireOwner(actor);
    return this.command(
      actor,
      key,
      { kind: "save_profile", input },
      async (db) => {
        const profileId = input.id ?? crypto.randomUUID();
        const existing = await db.qualityProfile.findUnique({
          where: { id: profileId },
        });
        if (
          (existing === null && input.id !== undefined) ||
          (existing?.version ?? 0) !== input.expectedVersion
        )
          throw new MediaError(
            "version_conflict",
            "Quality profile changed or does not exist",
            409,
          );
        const version = input.expectedVersion + 1;
        const affected = await db.mediaIntent.findMany({
          where: { profileId },
        });
        await lockMedia(
          db,
          affected.map((intent) => intent.mediaId),
        );
        await db.qualityProfile.upsert({
          where: { id: profileId },
          create: {
            id: profileId,
            name: input.name,
            version,
            rules: input.rules,
          },
          update: { name: input.name, version, rules: input.rules },
        });
        await db.qualityProfileVersion.create({
          data: { profileId, version, rules: input.rules },
        });
        for (const intent of affected) {
          const changed = await db.mediaIntent.update({
            where: { mediaId: intent.mediaId },
            data: { generation: { increment: 1 }, version: { increment: 1 } },
          });
          await this.enqueue(db, actor, {
            kind: "reconcile_media",
            mediaId: intent.mediaId,
            generation: changed.generation,
          });
        }
        return { profileId, version, status: "completed" };
      },
    );
  }

  assignProfile(
    actor: MediaActor,
    key: string,
    mediaId: string,
    input: { expectedVersion: number; profileId: string },
  ) {
    requireOwner(actor);
    return this.command(
      actor,
      key,
      { kind: "assign_profile", input: { mediaId, ...input } },
      async (db) => {
        const profile = await db.qualityProfile.findUnique({
          where: { id: input.profileId },
        });
        if (profile === null)
          throw new MediaError(
            "profile_not_found",
            "Quality profile does not exist",
            404,
          );
        const media = await db.mediaItem.updateMany({
          where: { id: mediaId, version: input.expectedVersion },
          data: { version: { increment: 1 } },
        });
        if (media.count !== 1)
          throw new MediaError(
            "version_conflict",
            "Media changed; refresh first",
            409,
          );
        const intent = await db.mediaIntent.upsert({
          where: { mediaId },
          create: { mediaId, profileId: profile.id, generation: 1 },
          update: {
            profileId: profile.id,
            generation: { increment: 1 },
            version: { increment: 1 },
          },
        });
        const operationId = await this.enqueue(db, actor, {
          kind: "reconcile_media",
          mediaId,
          generation: intent.generation,
        });
        return {
          operationId,
          status: "queued",
          version: input.expectedVersion + 1,
        };
      },
    );
  }
}

export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[\w.:-]+$/);
