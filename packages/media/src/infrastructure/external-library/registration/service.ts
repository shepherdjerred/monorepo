import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
} from "#infrastructure/editions/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  ExternalLibraryApplyResultSchema,
  ExternalLibraryPreviewInputSchema,
  ExternalLibraryApplyInputSchema,
  type ExternalLibraryPreviewInput,
  type ExternalLibraryApplyInput,
} from "#shared/external-library/contract.ts";
import {
  ExternalLibraryPreviewSchema,
  type ExternalLibrarySettings,
  type ExternalPlexObservation,
  type ExternalLibraryPreview,
} from "./contract.ts";
import { observeExternalLibrary } from "./observation.ts";
import {
  assertExternalLibraryOwner,
  captureExternalRegistrationPlan,
} from "./canonical.ts";
import { writeExternalRegistration } from "./write.ts";

export class PrismaExternalLibraryRegistration extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly external: ExternalLibrarySettings,
  ) {
    super(db, { keepDays: 30 });
  }

  async items(
    actor: MediaActor,
    sectionType: "movie" | "show",
    offset: number,
  ) {
    await assertExternalLibraryOwner(this.db, actor);
    const plex = await this.external.ownerClient(actor);
    const sections = await this.external.sections();
    const signal = AbortSignal.timeout(20_000);
    if (
      (await plex.machineIdentifier(signal)) !== this.external.serverMachineId
    )
      throw new MediaError(
        "external_library_identity_changed",
        "Configured Plex server changed",
        409,
      );
    const sectionId =
      sectionType === "movie" ? sections.movie : sections.series;
    const actual = await plex.sections(signal);
    if (
      actual.filter(
        (section) => section.key === sectionId && section.type === sectionType,
      ).length !== 1
    )
      throw new MediaError(
        "external_library_identity_changed",
        "Configured Plex section changed",
        409,
      );
    const page = await plex.libraryPage(
      {
        sectionId,
        kind: sectionType === "movie" ? "movie" : "episode",
        offset,
        limit: 25,
      },
      signal,
    );
    return {
      sectionId,
      sectionType,
      total: page.total,
      nextOffset:
        offset + page.items.length < page.total
          ? offset + page.items.length
          : null,
      items: page.items.map((item) => ({
        ratingKey: item.ratingKey,
        title: item.title,
        year: item.year ?? null,
        guids: item.Guid ?? [],
        parentRatingKey: item.parentRatingKey ?? null,
        grandparentRatingKey: item.grandparentRatingKey ?? null,
        seasonNumber: item.parentIndex ?? null,
        episodeNumber: item.index ?? null,
        observedEditionTitle: item.editionTitle ?? null,
        parts: (item.Media ?? []).flatMap((media) =>
          media.Part.map((part) => ({
            id: String(part.id),
            canonicalPath: part.file,
            sizeBytes: part.size === undefined ? null : String(part.size),
          })),
        ),
      })),
    };
  }

  async preview(
    actor: MediaActor,
    key: string,
    raw: ExternalLibraryPreviewInput,
  ) {
    const input = ExternalLibraryPreviewInputSchema.parse(raw);
    await assertExternalLibraryOwner(this.db, actor);
    let observed: ExternalPlexObservation | undefined;
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "preview_external_library", input },
        decode: (value) => ExternalLibraryPreviewSchema.parse(value),
        beforeNewCommand: async () => {
          observed = await observeExternalLibrary(
            this.db,
            actor,
            input,
            this.external,
          );
        },
      },
      async (tx) => {
        if (observed === undefined)
          throw new Error("External preview lost its actual PMS observation");
        await assertExternalLibraryOwner(tx, actor, true);
        const plan = await captureExternalRegistrationPlan(tx, observed);
        const operationId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 60_000).toISOString();
        const value = { operationId, expiresAt, plan };
        const view = ExternalLibraryPreviewSchema.parse({
          ...value,
          previewHash: identityHash(value),
        });
        await tx.operation.create({
          data: {
            id: operationId,
            kind: "preview_external_library",
            userId: actor.id,
            targetId: plan.root.id,
            payload: { operationId, input },
            status: "completed",
            result: { externalLibraryPreview: view },
          },
        });
        return z.record(z.string(), z.json()).parse(view);
      },
    );
  }

  async apply(actor: MediaActor, key: string, raw: ExternalLibraryApplyInput) {
    const input = ExternalLibraryApplyInputSchema.parse(raw);
    await assertExternalLibraryOwner(this.db, actor);
    let preview: ExternalLibraryPreview | undefined;
    let observed: ExternalPlexObservation | undefined;
    const active = () => {
      if (preview === undefined || Date.now() >= Date.parse(preview.expiresAt))
        throw new MediaError(
          "external_library_preview_expired",
          "Review a fresh external-library preview before applying it",
          409,
        );
    };
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "register_external_library", input },
        decode: (value) => ExternalLibraryApplyResultSchema.parse(value),
        beforeNewCommand: async () => {
          const prior = await this.db.operation.findUnique({
            where: { id: input.previewOperationId },
          });
          if (
            prior?.kind !== "preview_external_library" ||
            prior.userId !== actor.id ||
            prior.status !== "completed"
          )
            throw new MediaError(
              "external_library_preview_required",
              "Select this owner's actual external-library preview",
              409,
            );
          preview = z
            .object({ externalLibraryPreview: ExternalLibraryPreviewSchema })
            .parse(prior.result).externalLibraryPreview;
          const { previewHash, ...body } = preview;
          if (
            preview.operationId !== prior.id ||
            previewHash !== input.previewHash ||
            identityHash(body) !== previewHash
          )
            throw new MediaError(
              "external_library_preview_changed",
              "Stored external-library preview changed",
              409,
            );
          active();
          const original = z
            .object({ input: ExternalLibraryPreviewInputSchema })
            .parse(prior.payload).input;
          observed = await observeExternalLibrary(
            this.db,
            actor,
            original,
            this.external,
          );
          if (identityHash(observed) !== identityHash(preview.plan.observation))
            throw new MediaError(
              "external_library_preview_changed",
              "Plex item, hierarchy or physical Part changed; review again",
              409,
            );
        },
        assertCommit: active,
      },
      async (tx) => {
        if (preview === undefined || observed === undefined)
          throw new Error(
            "External registration lost its reviewed observation",
          );
        await assertExternalLibraryOwner(tx, actor, true);
        await lockCanonicalMedia(tx, [
          preview.plan.root.id,
          ...preview.plan.members.map((member) => member.mediaId),
        ]);
        await lockExistingDefaultTargets(
          tx,
          preview.plan.members.map((member) => member.mediaId),
        );
        active();
        const plan = await captureExternalRegistrationPlan(tx, observed);
        if (identityHash(plan) !== identityHash(preview.plan))
          throw new MediaError(
            "external_library_preview_changed",
            "Canonical catalog, target, ownership or coverage changed; review again",
            409,
          );
        return z
          .record(z.string(), z.json())
          .parse(await writeExternalRegistration(tx, actor, input, plan));
      },
    );
  }
}
