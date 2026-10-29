import { z } from "zod";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MoviePublicationAssetV2Schema } from "#shared/movie-editions/publication-v2.ts";
import { MovieRestoreReceiptV1Schema } from "#shared/movie-editions/restore-v1.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { prepareRemovalProof } from "#automation/files/content-proof.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRestoreSource } from "#infrastructure/movie-editions/retention/restore-source.ts";
import {
  captureMovieRestoreAuthority,
  assertRestoreTarget,
} from "#infrastructure/movie-editions/retention/restore-authority.ts";
import {
  readMovieRestoreReceiptV1,
  recordMovieRestoreReceiptV1,
} from "#infrastructure/movie-editions/retention/restore-commit.ts";
import { snapshotMovieRestoreAssetV1 } from "#infrastructure/movie-editions/retention/restore-snapshot.ts";
import { advanceSubtitleBindings } from "#automation/files/subtitle-lifecycle/ownership.ts";
import { assertOwnedAsset } from "#automation/files/removal-plan.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { restoreMovieEntryV1 } from "./restore-effects.ts";

/** An actual scoped physical successor; original acquisitions, adoptions and publication clocks remain literal. */
export async function restoreMovieFilesV4(
  base: FileContext,
  raw: MovieOperationV4,
): Promise<void> {
  const execution = requirePublicationExecution(base.publicationExecution?.());
  const input = MovieOperationV4Schema.parse(raw);
  const invocation = base.movieManagement;
  if (invocation === undefined)
    throw new FileGuardError("movie_management_context_missing");
  invocation.execution.assertActive();
  const budget = invocation.budget;
  if (await readMovieRestoreReceiptV1(base.db, input, budget)) return;
  const context = publicationInvocation(
    { ...base, now: () => new Date() },
    execution,
  );
  if (!(await context.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  const source = await readMovieRestoreSource(context.db, input, budget);
  const access = requireMovieChoiceAccess(
    (await fileMovieAccess(context, [input.mediaId])) ?? {},
  );
  const prepared = await prepareRemovalProof(context, source.manifest.assets);
  execution.assertActive();
  await prepared.db.$transaction(
    async (tx) => {
      await lockMovieCommand(tx, input.scope);
      await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
      if (await readMovieRestoreReceiptV1(tx, input, budget)) return;
      const current = await captureMovieRestoreAuthority(tx, {
        context: { ...prepared, execution },
        command: input,
        source,
        access,
      });
      const { freshness, before } = current;
      const movie = { scope: input.scope, budget };
      const authorize = async () => {
        await prepared.checkpoint("movie-restore-authorization");
        if (!(await prepared.enabled.acquisition()))
          throw new FileGuardError("acquisition_disabled");
        const configured = requireMovieChoiceAccess(
          (await fileMovieAccess(prepared, [input.mediaId])) ?? {},
        );
        if (identityHash(configured) !== identityHash(access))
          throw new FileGuardError("wrong_section");
        const target = await tx.mediaIntent.findUniqueOrThrow({
          where: {
            mediaId_edition: {
              mediaId: input.mediaId,
              edition: input.scope.edition,
            },
          },
        });
        assertRestoreTarget(
          target,
          input,
          current.source.command.recoveryEpoch,
        );
        await assertOwnedAsset(tx, current.source.entry, "quarantined", movie);
        freshness.assertActive();
      };
      await authorize();
      const evidence = await restoreMovieEntryV1(
        { ...prepared, execution },
        {
          entry: current.source.entry,
          operationId: input.operationId,
          authorize,
          assertActive: freshness.assertActive,
        },
      );
      const restored = await tx.libraryAsset.update({
        where: { id: before.id, version: before.version },
        data: { state: "published", version: { increment: 1 } },
      });
      await advanceSubtitleBindings(tx, {
        assetId: before.id,
        checksum: before.checksum,
        epoch: before.ownershipEpoch,
        fromVersion: before.version,
        toVersion: restored.version,
        fromState: "quarantined",
        state: "installed",
        sidecarIds: current.source.entry.sidecars.map((row) => row.subtitleId),
      });
      const after = MoviePublicationAssetV2Schema.parse(
        await snapshotMovieRestoreAssetV1(tx, input.scope, before.id, budget),
      );
      await tx.retentionDecision.update({
        where: {
          id: current.source.decision.id,
          version: current.source.decision.version,
        },
        data: {
          state: "restored",
          version: { increment: 1 },
          evidence: {
            ...z
              .record(z.string(), z.json())
              .parse(current.source.decision.evidence),
            restoreOperationId: input.operationId,
            restoredGenerations: { [input.mediaId]: input.generation },
          },
        },
      });
      await tx.mediaIntent.update({
        where: {
          mediaId_edition: {
            mediaId: input.mediaId,
            edition: input.scope.edition,
          },
        },
        data: { availability: "importing" },
      });
      await tx.mediaItem.update({
        where: { id: input.mediaId },
        data: {
          version: { increment: 1 },
          ...(input.scope.edition === "default"
            ? { availability: "importing" as const }
            : {}),
        },
      });
      const receipt = MovieRestoreReceiptV1Schema.parse({
        schemaVersion: 1,
        scope: input.scope,
        input,
        command: {
          kind: current.source.operation.kind,
          targetId: current.source.operation.targetId,
          userId: current.source.operation.userId,
          payloadHash: identityHash(current.source.operation.payload),
        },
        quarantine: {
          operationId: current.source.parent.id,
          receiptHash: current.source.receiptHash,
          decisionId: current.source.decision.id,
          manifestHash: current.source.receipt.manifestHash,
        },
        manifest: current.source.manifest,
        before,
        after,
        ...evidence,
        observedAt: new Date(execution.observed.wall).toISOString(),
        sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
        expiresAt: new Date(freshness.expiresAtMs).toISOString(),
        committedAt: new Date().toISOString(),
      });
      await recordMovieRestoreReceiptV1(tx, receipt, freshness, budget);
      freshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  execution.assertActive();
}
