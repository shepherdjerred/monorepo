import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { lockCommandActor } from "#infrastructure/editions/command-actor.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import {
  type QualityGuideApply,
  type QualityGuidePreview,
  GuideKindSchema,
} from "#shared/quality-guide/contract.ts";
import {
  QualityGuideApplyResultSchema,
  QualityGuidePreviewResultSchema,
  QualityGuideStatusSchema,
} from "#shared/quality-guide/view.ts";
import { compileQualityGuide } from "#domain/quality-guide/compile.ts";
import type { TrashGuideClient } from "#integrations/trash-guide/client.ts";
import { saveCompiledGuide, type CompiledGuide } from "./persistence.ts";

const SyncEventSchema = z.object({
  profileId: z.uuid(),
  status: z.enum(["updated", "unchanged", "deferred", "failed"]),
  revision: z.string().nullable(),
  reason: z.string().nullable(),
});

export class PrismaQualityGuideAdministration extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly guide: Pick<TrashGuideClient, "load">,
  ) {
    super(db, { keepDays: 30 });
  }

  private async owner(actor: MediaActor) {
    const current = await this.db.mediaUser.findUnique({
      where: { id: actor.id },
    });
    if (current?.plexAccountId !== actor.plexAccountId)
      throw new MediaError("unauthenticated", "Sign in again", 401);
    requireOwner(current);
  }

  async preview(actor: MediaActor, input: QualityGuidePreview) {
    await this.owner(actor);
    const compiled = compileQualityGuide(
      input.kind,
      await this.guide.load(input.kind),
      input.scoreOverrides,
    );
    const managed = compiled.rules.managedGuide;
    if (managed === undefined)
      throw new Error("Compiled guide omitted its immutable source");
    return QualityGuidePreviewResultSchema.parse({
      kind: input.kind,
      ...compiled,
      revision: managed.revision,
      contentHash: managed.contentHash,
    });
  }

  apply(actor: MediaActor, key: string, input: QualityGuideApply) {
    let compiled: CompiledGuide | undefined;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "apply_quality_guide", input },
        decode: (value) => QualityGuideApplyResultSchema.parse(value),
        beforeNewCommand: async () => {
          await this.owner(actor);
          compiled = compileQualityGuide(
            input.kind,
            await this.guide.load(input.kind),
            input.scoreOverrides,
          );
          if (
            compiled.rules.managedGuide?.revision !== input.expectedRevision ||
            compiled.rules.managedGuide.contentHash !==
              input.expectedContentHash
          )
            throw new MediaError(
              "guide_changed",
              "The selected guide changed; preview it again before applying",
              409,
            );
        },
      },
      async (tx) => {
        requireOwner(await lockCommandActor(tx, actor));
        if (compiled === undefined)
          throw new Error("Guide was not prepared before its command");
        return saveCompiledGuide(tx, {
          profileId: input.profileId ?? crypto.randomUUID(),
          expectedVersion: input.expectedVersion,
          compiled,
          create: input.profileId === null,
        });
      },
    );
  }

  async status(actor: MediaActor) {
    await this.owner(actor);
    const profiles = await this.db.qualityProfile.findMany({
      where: {
        rules: { path: ["managedGuide", "preset"], equals: "living-room-v1" },
      },
      orderBy: { id: "asc" },
      take: 26,
    });
    if (profiles.length > 25)
      throw new Error(
        "Managed guide profile inventory exceeds its bounded contract",
      );
    return QualityGuideStatusSchema.parse(
      await Promise.all(
        profiles.map(async (profile) => {
          const managed = QualityRulesSchema.parse(profile.rules).managedGuide;
          if (managed === undefined)
            throw new Error(
              "Managed profile inventory returned an unmanaged profile",
            );
          const event = await this.db.applicationEvent.findFirst({
            where: {
              kind: "quality_guide_sync",
              payload: { path: ["profileId"], equals: profile.id },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          const sync =
            event === null ? null : SyncEventSchema.parse(event.payload);
          return {
            id: profile.id,
            name: profile.name,
            version: profile.version,
            kind: GuideKindSchema.parse(managed.kind),
            revision: managed.revision,
            contentHash: managed.contentHash,
            scoreOverrides: managed.scoreOverrides,
            lastSync:
              sync === null || event === null
                ? null
                : { ...sync, at: event.createdAt.toISOString() },
          };
        }),
      ),
    );
  }
}
