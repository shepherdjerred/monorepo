import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaCommandSettings } from "#infrastructure/command-base.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { lockCommandActor } from "#infrastructure/editions/command-actor.ts";
import {
  lockBindingUsers,
  lockLegacyRequesterBindings,
} from "#infrastructure/recovery/legacy-claims/bindings.ts";
import {
  PersonalMigrationInputSchema,
  ApplyPersonalMigrationSchema,
  type PersonalMigrationClaim,
  ReconcilePersonalMigrationSchema,
  PersonalMigrationCursorSchema,
} from "#shared/personal-migration/contract.ts";
import { previewPersonalMigration } from "./preview.ts";
import { createImportedSourceClaim } from "./source-claim.ts";
import { importedPersonalClaims } from "./imported.ts";
import { releasePersonalMigrationHolds } from "./holds.ts";
import { PassiveRegistrationPreviewInputSchema } from "#shared/handoff/passive-registration.ts";
import { previewPassiveRegistrations } from "./passive-preview.ts";

/** Owner-approved migration preserves genuine source interest, never a new acquisition consent. */
export class PrismaPersonalMigration extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    settings: MediaCommandSettings,
  ) {
    super(db, settings);
  }
  imported(actor: MediaActor) {
    return importedPersonalClaims(this.db, actor);
  }
  async passive(
    actor: MediaActor,
    raw: z.input<typeof PassiveRegistrationPreviewInputSchema>,
  ) {
    requireOwner(actor);
    const input = PassiveRegistrationPreviewInputSchema.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const owner = await lockCommandActor(tx, actor);
        requireOwner(owner);
        if (owner.restricted)
          throw new MediaError(
            "owner_required",
            "An unrestricted owner is required",
            403,
          );
        return previewPassiveRegistrations(tx, input);
      },
      { isolationLevel: "RepeatableRead", timeout: 15_000 },
    );
  }

  async preview(
    actor: MediaActor,
    raw: z.input<typeof PersonalMigrationInputSchema>,
  ) {
    requireOwner(actor);
    if (actor.restricted)
      throw new MediaError(
        "owner_required",
        "An unrestricted owner is required",
        403,
      );
    const input = PersonalMigrationInputSchema.parse(raw);
    return this.db.$transaction(
      async (tx) => {
        const current = await lockCommandActor(tx, actor);
        requireOwner(current);
        if (current.restricted)
          throw new MediaError(
            "owner_required",
            "An unrestricted owner is required",
            403,
          );
        return previewPersonalMigration(tx, input, this.machineId());
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );
  }

  async apply(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof ApplyPersonalMigrationSchema>,
  ) {
    requireOwner(actor);
    const input = ApplyPersonalMigrationSchema.parse(raw);
    const selection = PersonalMigrationInputSchema.parse({
      captureIds: input.captureIds,
      movieEditions: input.movieEditions,
      historyOnly: input.historyOnly,
    });
    const current = await this.db.mediaUser.findUniqueOrThrow({
      where: { id: actor.id },
    });
    requireOwner(current);
    if (current.restricted)
      throw new MediaError(
        "owner_required",
        "An unrestricted owner is required",
        403,
      );
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "personal_state_import", input },
        decode: (value) =>
          z
            .strictObject({
              status: z.literal("completed"),
              version: z.literal(1),
              eventId: z.uuid(),
              next: PersonalMigrationCursorSchema.nullable(),
            })
            .parse(value),
      },
      async (tx) => {
        const owner = await lockCommandActor(tx, actor);
        requireOwner(owner);
        if (owner.restricted)
          throw new MediaError(
            "owner_required",
            "An unrestricted owner is required",
            403,
          );
        const preview = await previewPersonalMigration(
          tx,
          selection,
          this.machineId(),
        );
        await lockBindingUsers(tx, [
          actor.id,
          ...preview.claims.flatMap((claim) =>
            claim.userId === null ? [] : [claim.userId],
          ),
        ]);
        // Match the existing binding command's users-before-knowledge lock order.
        await lockLegacyRequesterBindings(tx);
        if (preview.previewHash !== input.previewHash)
          throw new MediaError(
            "personal_migration_stale",
            "Migration evidence or native state changed; preview again",
            409,
          );
        if (preview.blocked)
          throw new MediaError(
            "personal_migration_blocked",
            "Resolve exact identities and selected scopes, or explicitly retain obsolete requests as history",
            409,
          );
        const imports = await this.importClaims(tx, actor, {
          claims: preview.claims,
        });
        for (const scope of preview.library)
          await tx.mediaIntent.updateMany({
            where: {
              mediaId: scope.mediaId,
              edition: scope.edition,
              libraryPolicyExplicit: false,
              libraryKeep: false,
            },
            data: { libraryKeep: true, version: { increment: 1 } },
          });
        // Retain every source disposition, including declined/obsolete history.
        // This receipt does not assert playback completion or transfer authority.
        const sourceRecords = await tx.migrationRecord.findMany({
          where: { captureId: { in: selection.captureIds }, kind: "request" },
          select: {
            captureId: true,
            provenanceKey: true,
            observationHash: true,
          },
          orderBy: [{ captureId: "asc" }, { provenanceKey: "asc" }],
          take: 1001,
        });
        if (sourceRecords.length > 1000)
          throw new Error("Personal source receipt exceeds bounded claims");
        const event = await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "personal_state_imported",
            dedupeKey: `personal-import:${input.previewHash}`,
            payload: z.record(z.string(), z.json()).parse({
              schemaVersion: 1,
              previewHash: preview.previewHash,
              captures: preview.captures,
              claims: preview.claims,
              sourceRecords,
              imports,
              library: preview.library,
              keepingPolicy: "temporary",
              interestState: "following",
              changesPlaybackState: false,
              transfersTorrentOwnership: false,
            }),
          },
        });
        const reconciliation = await releasePersonalMigrationHolds(tx, {
          actorId: actor.id,
          eventId: event.id,
        });
        return {
          status: "completed",
          version: 1,
          eventId: event.id,
          next: reconciliation.next,
        };
      },
    );
  }
  async reconcile(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof ReconcilePersonalMigrationSchema>,
  ) {
    requireOwner(actor);
    const input = ReconcilePersonalMigrationSchema.parse(raw);
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "personal_state_reconcile", input },
        decode: (value) =>
          z
            .strictObject({
              status: z.literal("completed"),
              version: z.literal(1),
              released: z.int().nonnegative().max(25),
              next: PersonalMigrationCursorSchema.nullable(),
            })
            .parse(value),
      },
      async (tx) => {
        const owner = await lockCommandActor(tx, actor);
        requireOwner(owner);
        if (owner.restricted)
          throw new MediaError(
            "owner_required",
            "An unrestricted owner is required",
            403,
          );
        const event = await tx.applicationEvent.findUniqueOrThrow({
          where: { id: input.eventId },
        });
        if (event.kind !== "personal_state_imported" || event.actorId === null)
          throw new Error(
            "Reconciliation requires a genuine personal import receipt",
          );
        z.object({
          schemaVersion: z.literal(1),
          keepingPolicy: z.literal("temporary"),
          interestState: z.literal("following"),
          changesPlaybackState: z.literal(false),
          transfersTorrentOwnership: z.literal(false),
        }).parse(event.payload);
        const result = await releasePersonalMigrationHolds(tx, {
          actorId: owner.id,
          ...input,
        });
        return { status: "completed", version: 1, ...result };
      },
    );
  }
  private async importClaims(
    tx: Prisma.TransactionClient,
    actor: MediaActor,
    options: {
      claims: PersonalMigrationClaim[];
    },
  ) {
    const { claims } = options;
    const imports = [];
    for (const claim of claims) {
      if (
        !["import", "existing"].includes(claim.disposition) ||
        claim.userId === null ||
        claim.edition === null
      )
        continue;
      for (const mediaId of claim.mediaIds) {
        const result = await this.importOne(tx, actor, {
          mediaId,
          userId: claim.userId,
          edition: claim.edition,
        });
        imports.push({
          requestId: result.request.id,
          mediaId,
          userId: claim.userId,
          edition: claim.edition,
          captureId: claim.captureId,
          provenanceKey: claim.provenanceKey,
          sourceId: claim.sourceId,
          sourceStatus: claim.sourceStatus,
          needsAcquisitionChoice: result.needsAcquisitionChoice,
        });
      }
    }
    return imports;
  }
  private machineId() {
    const value = this.settings.serverMachineId;
    if (value === undefined)
      throw new MediaError(
        "plex_scope_unconfigured",
        "Plex migration identity is not configured",
        503,
      );
    return value;
  }
  private async importOne(
    tx: Prisma.TransactionClient,
    actor: MediaActor,
    options: {
      mediaId: string;
      userId: string;
      edition: MovieEditionKey;
    },
  ) {
    const result = await createImportedSourceClaim(tx, options);
    if (result.command !== null) await this.enqueue(tx, actor, result.command);
    return result;
  }
}
