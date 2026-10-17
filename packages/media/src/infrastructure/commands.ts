import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { MediaAction } from "#shared/contract.ts";
import type { SaveQualityProfile } from "#shared/api.ts";
import {
  invalidateRetention,
  validateAction,
  applyHold,
  actionIntentChange,
  actionCommand,
  initialActionIntent,
} from "./action-guards.ts";
import { needsRestore } from "./locks.ts";
import { confirmRemoval } from "./removal-confirmation.ts";
import { lockDefaultScopes } from "./editions/locks.ts";
import { targetWhere } from "./editions/targets.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { prepareActionAuthority } from "./acquisition-identity/action.ts";

import { MediaRequestCommands } from "./request-commands.ts";
export class PrismaMediaCommands extends MediaRequestCommands {
  setProfileDefault(
    actor: MediaActor,
    key: string,
    kind: "movie" | "series",
    input: { expectedVersion: number; profileId: string },
  ) {
    requireOwner(actor);
    return this.command(
      actor,
      key,
      { kind: "profile_default", input: { kind, ...input } },
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
        const prior = await db.qualityProfileDefault.findUnique({
          where: { kind },
        });
        if ((prior?.version ?? 0) !== input.expectedVersion)
          throw new MediaError(
            "version_conflict",
            "Default quality profile changed",
            409,
          );
        const version = input.expectedVersion + 1;
        await db.qualityProfileDefault.upsert({
          where: { kind },
          create: { kind, profileId: profile.id, version },
          update: { profileId: profile.id, version },
        });
        await db.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "profile_default_changed",
            payload: { mediaKind: kind, profileId: profile.id, version },
          },
        });
        return { profileId: profile.id, version, status: "completed" };
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
        const { authority, currentActor, identityDecision, targetExisted } =
          await prepareActionAuthority(db, actor, {
            mediaId,
            input,
            settings: this.settings,
          });
        await validateAction(db, currentActor, mediaId, input);
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
          where: targetWhere(defaultScope(mediaId)),
          create: {
            mediaId,
            generation: 1,
            ...authority,
            ...initialActionIntent(input.action),
          },
          update: {
            ...authority,
            generation: { increment: 1 },
            version: targetExisted ? { increment: 1 } : 0,
            ...(targetExisted ? {} : initialActionIntent(input.action)),
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
              where: targetWhere(defaultScope(item.id)),
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
            ...(identityDecision === null ? {} : { identityDecision }),
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
          where: { profileId, edition: "default" },
        });
        await lockDefaultScopes(
          db,
          affected.map((intent) => defaultScope(intent.mediaId)),
          { createMissing: false },
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
            where: targetWhere(defaultScope(intent.mediaId)),
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
        const targets = await lockDefaultScopes(db, [defaultScope(mediaId)], {
          createMissing: true,
        });
        const target = targets[0];
        if (target === undefined) throw new Error("Profile target missing");
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
          where: targetWhere(defaultScope(mediaId)),
          create: { mediaId, profileId: profile.id, generation: 1 },
          update: {
            profileId: profile.id,
            generation: { increment: 1 },
            version: target.existed ? { increment: 1 } : 0,
            ...(target.existed
              ? {}
              : { desiredPresence: true, monitoring: true }),
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
