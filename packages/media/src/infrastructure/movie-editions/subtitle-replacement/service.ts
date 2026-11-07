import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import {
  MediaCommandBase,
  type MediaCommandSettings,
} from "#infrastructure/command-base.ts";
import {
  MovieManualReplacementV2Schema,
  MoviePrepareReplacementV2Schema,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { parseManualSubtitle } from "#infrastructure/manual-subtitle.ts";
import {
  assertReplacementOwner,
  lockSubtitleReplacementScope,
} from "#infrastructure/subtitle-replacement/locks.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import {
  lockRuntimeAuthority,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { queueOperation } from "#automation/store.ts";
import { captureMovieReplacementSnapshotV2 } from "./snapshot.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { requireMovieReplacementUploadTarget } from "./upload-target.ts";
import { reserveMovieRollbackCaptionSqlV1 } from "#infrastructure/movie-editions/rollback/read-budget.ts";
import { hasPendingMovieRollbackCaptionParticipantV1 } from "#infrastructure/movie-editions/rollback/pending.ts";
import { movieSubtitleTargetV2 } from "./target-view.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";

/** Internal explicit movie protocol; existing unscoped uploads and routes retain their meaning. */
export class PrismaMovieSubtitleReplacements extends MediaCommandBase {
  readonly review: PrismaSubtitleReplacements;
  constructor(
    private readonly movieDatabase: Database,
    settings: MediaCommandSettings,
    describe: MediaAutomationContext["describeWorkflow"],
  ) {
    super(movieDatabase, settings);
    this.review = new PrismaSubtitleReplacements(movieDatabase, describe, () =>
      this.configuredMovieChoiceAccess(),
    );
  }

  async context(actor: MediaActor, scope: MovieEditionScope) {
    requireOwner(actor);
    const selected = MovieEditionScopeSchema.parse(scope);
    const budget = new PublicationAuthorityReadBudget();
    const access = await this.configuredMovieChoiceAccess();
    return this.movieDatabase.$transaction(
      (tx) =>
        movieSubtitleTargetV2(tx, { actor, scope: selected, access, budget }),
      { isolationLevel: "RepeatableRead", timeout: 15_000 },
    );
  }

  async upload(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof MovieManualReplacementV2Schema>,
  ) {
    requireOwner(actor);
    const input = MovieManualReplacementV2Schema.parse(raw);
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024)
      throw new MediaError(
        "subtitle_size",
        "Subtitle must be between one byte and 8 MiB",
        422,
      );
    const validated = parseManualSubtitle(input, bytes);
    return this.command(
      actor,
      key,
      { kind: "upload_movie_subtitle_replacement_v2", input },
      async (tx) => {
        const access = await this.configuredMovieChoiceAccess();
        const budget = new PublicationAuthorityReadBudget();
        await lockSubtitleReplacementScope(tx, {
          assetId: input.assetId,
          mediaIds: [input.scope.mediaId],
          movieScope: input.scope,
        });
        await assertReplacementOwner(tx, actor.id);
        if (
          await hasPendingMovieRollbackCaptionParticipantV1(
            tx,
            { scope: input.scope, assetId: input.assetId },
            budget,
          )
        )
          throw new MediaError(
            "movie_rollback_active",
            "Complete the admitted movie rollback before changing its captions",
            409,
          );
        const runtime = await runtimeAuthority(tx);
        if (!runtime.active || !(await lockRuntimeAuthority(tx, runtime.epoch)))
          throw new MediaError(
            "runtime_protected",
            "Current movie runtime authority is required",
            409,
          );
        const work = await currentMovieSubtitleWorkV4(
          tx,
          {
            scope: input.scope,
            assetId: input.assetId,
            epoch: runtime.epoch,
            access,
          },
          budget,
        );
        const { asset } = work;
        const { old, target } = requireMovieReplacementUploadTarget(
          work,
          input,
          runtime.epoch,
        );
        const destination = subtitleDestination({
          videoPath: asset.path,
          language: input.language,
          forced: input.forced ?? false,
          hearingImpaired: input.hearingImpaired ?? null,
          format: validated.format,
        });
        const checksum = createHash("sha256")
          .update(validated.text)
          .digest("hex");
        if (destination !== old.path || checksum === old.checksum)
          throw new MediaError(
            "replacement_path_changed",
            "Replacement needs distinct bytes at the same exact caption destination",
            409,
          );
        const id = crypto.randomUUID();
        const eventId = crypto.randomUUID();
        await tx.subtitleAsset.create({
          data: {
            id,
            assetId: asset.id,
            language: input.language,
            providerId: "manual",
            state: "validated",
            qualityStatus: "accepted",
            storageKind: "sidecar",
            ownershipEpoch: runtime.epoch,
            checksum,
            videoChecksum: asset.checksum,
            videoVersion: asset.version,
            forced: input.forced ?? false,
            hearingImpaired: input.hearingImpaired ?? null,
            content: new TextEncoder().encode(validated.text),
            provenance: {
              filename: input.filename,
              description: input.description,
              format: validated.format,
              checksum,
              uploadedBy: actor.id,
              simplifiedEvidence: validated.simplifiedEvidence,
              traditionalEvidence: validated.traditionalEvidence,
            },
            matchingEvidence: {
              schemaVersion: 2,
              movieScope: input.scope,
              assetVersion: asset.version,
              assetChecksum: asset.checksum,
              exactMediaMatch: true,
              videoVersionMatch: true,
              ownerConfirmed: true,
              targetAuthority: work.authority,
              recoveryEpoch: runtime.epoch,
              generations: { [input.scope.mediaId]: target.generation },
              replacementFor: input.replacementFor,
              movieManualReplacementV2: { schemaVersion: 2, eventId },
            },
          },
        });
        await tx.applicationEvent.create({
          data: {
            id: eventId,
            actorId: actor.id,
            mediaId: input.scope.mediaId,
            kind: "movie_subtitle_replacement_candidate_v2",
            payload: {
              scope: input.scope,
              subtitleId: id,
              oldSubtitleId: old.id,
              assetId: asset.id,
              checksum,
              expectedOldVersion: old.version,
              assetVersion: asset.version,
            },
          },
        });
        work.freshness.assertActive();
        return { subtitleId: id, status: "completed" };
      },
    );
  }

  async prepare(
    actor: MediaActor,
    key: string,
    raw: z.input<typeof MoviePrepareReplacementV2Schema>,
  ) {
    requireOwner(actor);
    const input = MoviePrepareReplacementV2Schema.parse(raw);
    return this.command(
      actor,
      key,
      { kind: "prepare_movie_subtitle_replacement_v2", input },
      async (tx) => {
        const access = await this.configuredMovieChoiceAccess();
        const budget = new PublicationAuthorityReadBudget();
        const old = await tx.subtitleAsset.findUniqueOrThrow({
          where: { id: input.oldSubtitleId },
        });
        await lockSubtitleReplacementScope(tx, {
          assetId: old.assetId,
          mediaIds: [input.scope.mediaId],
          movieScope: input.scope,
        });
        await assertReplacementOwner(tx, actor.id);
        if (
          await hasPendingMovieRollbackCaptionParticipantV1(
            tx,
            { scope: input.scope, assetId: old.assetId },
            budget,
          )
        )
          throw new MediaError(
            "movie_rollback_active",
            "Complete the admitted movie rollback before changing its captions",
            409,
          );
        const runtime = await runtimeAuthority(tx);
        if (!runtime.active || !(await lockRuntimeAuthority(tx, runtime.epoch)))
          throw new MediaError(
            "runtime_protected",
            "Current movie runtime authority is required",
            409,
          );
        const { snapshot, freshness } = await captureMovieReplacementSnapshotV2(
          tx,
          {
            scope: input.scope,
            assetId: old.assetId,
            oldSubtitleId: old.id,
            candidateSubtitleId: input.candidateSubtitleId,
            epoch: runtime.epoch,
          },
          { access, budget },
        );
        if (
          snapshot.old.version !== input.expectedOldVersion ||
          snapshot.candidate.version !== input.expectedCandidateVersion
        )
          throw new MediaError(
            "subtitle_replacement_changed",
            "Inspect current caption versions before preparing",
            409,
          );
        const id = crypto.randomUUID();
        reserveMovieRollbackCaptionSqlV1(budget, snapshot, "capture");
        const row = await tx.subtitleReplacement.create({
          data: {
            id,
            ownerId: actor.id,
            assetId: old.assetId,
            oldSubtitleId: old.id,
            candidateSubtitleId: input.candidateSubtitleId,
            recoveryEpoch: runtime.epoch,
            runtimeVersion: snapshot.runtimeVersion,
            snapshot: z
              .record(z.string(), z.json())
              .parse(nativeJson(snapshot)),
            snapshotHash: identityHash(nativeJson(snapshot)),
            importOperationId: `subtitle-replace-${id}`,
            rollbackOperationId: `subtitle-revert-${id}`,
          },
        });
        const queuedAt = new Date();
        const operationId = await queueOperation(tx, {
          key: `subtitle-replacement-prepare:${id}`,
          kind: "prepare_subtitle_replacement",
          targetId: id,
          userId: actor.id,
          createdAt: queuedAt,
          availableAt: queuedAt,
          payload: { replacementId: id, movieScope: input.scope },
        });
        await tx.subtitleReplacement.update({
          where: { id },
          data: { coordinatorOperationId: operationId },
        });
        freshness.assertActive();
        return {
          subtitleReplacementId: id,
          operationId,
          status: "queued",
          version: row.version,
        };
      },
    );
  }
}
