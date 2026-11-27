import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import type { SaveQualityProfile } from "#shared/api.ts";
import { ManagedGuideSchema } from "#shared/quality-guide/contract.ts";
import { retireQualityProfile, type RetireProfile } from "./retire.ts";

const ProfileGuide = z.object({ managedGuide: ManagedGuideSchema.optional() });

export class QualityProfileCommands extends MovieLifecycleCommands {
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
        if (profile?.replacedByProfileId !== null)
          throw new MediaError(
            "profile_not_found",
            "Quality profile does not exist",
            404,
          );
        const guide = ProfileGuide.parse(profile.rules).managedGuide;
        if (guide?.kind !== undefined && guide.kind !== kind)
          throw new MediaError(
            "profile_kind_mismatch",
            "Choose a profile for this media type",
            422,
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
  saveProfile(actor: MediaActor, key: string, input: SaveQualityProfile) {
    requireOwner(actor);
    if (input.rules.managedGuide !== undefined)
      throw new MediaError(
        "managed_guide_profile",
        "Use the selected-guide preview and apply controls to preserve guide provenance and score overrides",
        422,
      );
    return this.command(
      actor,
      key,
      { kind: "save_profile", input },
      async (db) => {
        const profileId = input.id ?? crypto.randomUUID();
        const existing = await db.qualityProfile.findUnique({
          where: { id: profileId },
        });
        if (existing?.replacedByProfileId != null)
          throw new MediaError(
            "quality_profile_retired",
            "This profile has been retired",
            409,
          );
        if (
          existing !== null &&
          z
            .object({ managedGuide: z.unknown().optional() })
            .parse(existing.rules).managedGuide !== undefined
        )
          throw new MediaError(
            "managed_guide_profile",
            "Update this managed profile through its selected-guide preview so its overrides and provenance remain intact",
            422,
          );
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
        if (profile?.replacedByProfileId !== null)
          throw new MediaError(
            "profile_not_found",
            "Quality profile does not exist",
            404,
          );
        const guide = ProfileGuide.parse(profile.rules).managedGuide;
        if (guide !== undefined) {
          const title = await db.mediaItem.findUniqueOrThrow({
            where: { id: mediaId },
            select: { kind: true },
          });
          if (guide.kind !== (title.kind === "movie" ? "movie" : "series"))
            throw new MediaError(
              "profile_kind_mismatch",
              "Choose a profile for this media type",
              422,
            );
        }
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

  retireProfile(
    actor: MediaActor,
    key: string,
    profileId: string,
    input: RetireProfile,
  ) {
    requireOwner(actor);
    return this.command(
      actor,
      key,
      { kind: "retire_quality_profile", input: { profileId, ...input } },
      async (db) => retireQualityProfile(db, actor, profileId, input),
    );
  }
}
