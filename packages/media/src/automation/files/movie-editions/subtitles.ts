import { z } from "zod";
import {
  FileGuardError,
  type FileContext,
  type Transaction,
} from "#automation/files/types.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { assertRuntime } from "#automation/files/guards.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import {
  readMovieSubtitleReceiptV4,
  assertMovieSubtitleReceiptV4,
} from "#infrastructure/movie-editions/subtitle-receipt.ts";
import {
  MovieSubtitleInstallV4Schema,
  MovieSubtitleOperationV4Schema,
  movieSubtitleTargetV4,
  type MovieSubtitleInstallV4,
} from "#shared/movie-editions/subtitles-v4.ts";
import { MovieSubtitleReceiptV4Schema } from "#shared/movie-editions/subtitle-receipt-v4.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { queueReadyMovieCaptionNoticesV4 } from "#automation/movie-editions/notifications/captions.ts";
import { assertMovieSubtitleOperationV4 } from "#automation/movie-editions/subtitles/operation.ts";
import {
  reusableSubtitle,
  targetRequired,
  subtitleTargetsReady,
} from "#automation/subtitles/authority.ts";
import { stageSubtitleContent } from "#automation/files/subtitle-lifecycle/content.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import {
  storedFilePath,
  storedWorkerPath,
} from "#automation/files/paths/locations.ts";

/** A movie v4 Activity installs one exact target; no unscoped operation supplies edition authority. */
export async function installMovieSubtitlesV4(
  initial: FileContext,
  raw: MovieSubtitleInstallV4,
): Promise<void> {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const budget =
    initial.movieManagement?.budget ?? new PublicationAuthorityReadBudget();
  const context = {
    ...publicationInvocation(initial, execution),
    movieManagement: { execution, budget },
  };
  const input = MovieSubtitleInstallV4Schema.parse(raw);
  if ((await readMovieSubtitleReceiptV4(context.db, input, budget)) !== null) {
    execution.assertActive();
    execution.signal.throwIfAborted();
    return;
  }
  const access = requireMovieChoiceAccess(
    (await fileMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  const operation = await context.db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const target = MovieSubtitleOperationV4Schema.parse(
    z.object(MovieSubtitleOperationV4Schema.shape).parse(operation.payload),
  );
  if (
    target.assetId !== input.assetId ||
    identityHash(nativeJson(target.scope)) !==
      identityHash(nativeJson(input.scope))
  )
    throw new FileGuardError("subtitle_operation_changed");
  const subtitle = await context.db.subtitleAsset.findUniqueOrThrow({
    where: { id: input.subtitleId },
    include: { asset: true },
  });
  const before = publicationSubtitleSnapshot(subtitle);
  if (
    subtitle.assetId !== input.assetId ||
    z
      .object({ replacementFor: z.unknown() })
      .safeParse(subtitle.matchingEvidence).success
  )
    throw new FileGuardError("subtitle_replacement_review_required");
  const authorize = async (tx: Transaction) => {
    await assertPublicationUnfenced(tx, [input.scope.mediaId], [input.assetId]);
    await context.checkpoint("movie-subtitle-authorization");
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    await assertRuntime(tx, target.recoveryEpoch);
    await assertMovieSubtitleOperationV4(tx, target);
    const work = await currentMovieSubtitleWorkV4(
      tx,
      {
        scope: input.scope,
        assetId: input.assetId,
        epoch: target.recoveryEpoch,
        access,
      },
      budget,
    );
    const current = work.asset.subtitles.find(
      (row) => row.id === input.subtitleId,
    );
    if (
      current === undefined ||
      work.protectedReasons.length > 0 ||
      work.authority !== target.targetAuthority ||
      !targetRequired(work, movieSubtitleTargetV4(target)) ||
      identityHash(nativeJson(publicationSubtitleSnapshot(current))) !==
        identityHash(nativeJson(before)) ||
      !reusableSubtitle(
        current,
        work,
        target.recoveryEpoch,
        movieSubtitleTargetV4(target),
      )
    )
      throw new FileGuardError("subtitle_target_changed");
    work.freshness.assertActive();
    return work;
  };
  const lock = async (tx: Transaction) => {
    await lockMovieCommand(tx, input.scope);
    await assertRuntime(tx, target.recoveryEpoch);
    await lockSubtitlePolicies(tx);
    await assertNoSubtitleReplacement(tx, [input.assetId]);
    await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${input.assetId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE id=${input.subtitleId} FOR UPDATE`;
  };
  const preparedAuthority = await context.db.$transaction(async (tx) => {
    await lock(tx);
    const work = await authorize(tx);
    if (subtitle.state === "installed")
      await subtitleVideoGrant(tx, input, budget);
    work.freshness.assertActive();
    const storage = await publicationAuthorityDeadline(tx, context, {
      libraryKind: "movies",
      recoveryEpoch: target.recoveryEpoch,
    });
    return plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(storage.expiresAtMs, work.freshness.expiresAtMs),
      guards: [storage, work.freshness],
    });
  });
  if (subtitle.state === "installed") {
    execution.assertActive();
    execution.signal.throwIfAborted();
    return;
  }
  const staged = await stageSubtitleContent(
    context,
    subtitle,
    input.operationId,
  );
  if (staged.location.libraryKind !== "movies")
    throw new FileGuardError("movie_subtitle_scope_changed");
  await context.db.$transaction(
    async (tx) => {
      await lock(tx);
      if ((await readMovieSubtitleReceiptV4(tx, input, budget)) !== null)
        return;
      const work = await authorize(tx);
      const publication = await subtitleVideoGrant(tx, input, budget);
      const storage = await publicationAuthorityDeadline(tx, context, {
        libraryKind: "movies",
        recoveryEpoch: target.recoveryEpoch,
      });
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          storage.expiresAtMs,
          work.freshness.expiresAtMs,
          preparedAuthority.expiresAtMs,
        ),
        guards: [preparedAuthority, storage, work.freshness],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      const manifest = await fileOperations(
        context,
        { ...staged.roots, downloads: staged.roots.control },
        async () => {
          await authorize(tx);
        },
        freshness.assertActive,
      ).importFile({ ...staged.descriptor, allowDuplicateTarget: false });
      await context.checkpoint("movie-subtitle-before-commit");
      const matchingEvidence = {
        ...z.record(z.string(), z.json()).parse(subtitle.matchingEvidence),
        schemaVersion: 4,
        movieScope: input.scope,
        targetAuthority: target.targetAuthority,
        target: movieSubtitleTargetV4(target),
        movieInstallationV4: {
          schemaVersion: 4,
          operationId: input.operationId,
        },
      };
      const installed = await tx.subtitleAsset.update({
        where: { id: input.subtitleId, version: subtitle.version },
        data: {
          state: "installed",
          path: storedFilePath(
            context,
            "movies",
            "library",
            staged.libraryPath,
          ),
          provenance: { ...staged.provenance, checksum: staged.checksum },
          matchingEvidence,
          version: { increment: 1 },
        },
      });
      const receipt = MovieSubtitleReceiptV4Schema.parse({
        schemaVersion: 4,
        input,
        target,
        command: {
          kind: operation.kind,
          targetId: operation.targetId,
          payloadHash: identityHash(operation.payload),
        },
        publication,
        videoPath: work.asset.path,
        before,
        after: publicationSubtitleSnapshot(installed),
        journal: {
          ...manifest,
          source: storedWorkerPath(context, "movies", manifest.source),
          target: storedWorkerPath(context, "movies", manifest.target),
        },
        committedAt: new Date().toISOString(),
        observedAt: new Date(execution.observed.wall).toISOString(),
        sdkExpiresAt: new Date(execution.expiresAtMs).toISOString(),
        expiresAt: new Date(freshness.expiresAtMs).toISOString(),
      });
      assertMovieSubtitleReceiptV4(receipt);
      const envelope = {
        receipt: nativeJson(receipt),
        receiptHash: identityHash(nativeJson(receipt)),
      };
      const count =
        await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('movieSubtitleReceiptV4',${JSON.stringify(envelope)}::jsonb) WHERE id=${input.operationId} AND NOT (COALESCE(result,'{}'::jsonb) ? 'movieSubtitleReceiptV4')`;
      if (
        count !== 1 ||
        (await readMovieSubtitleReceiptV4(tx, input, budget)) === null
      )
        throw new Error(
          "Movie subtitle receipt did not commit with its actual installation",
        );
      const ready = await currentMovieSubtitleWorkV4(
        tx,
        {
          scope: input.scope,
          assetId: input.assetId,
          epoch: target.recoveryEpoch,
          access,
        },
        budget,
      );
      if (
        ready.targets.length > 0 &&
        subtitleTargetsReady(ready, target.recoveryEpoch)
      )
        await tx.applicationEvent.upsert({
          where: {
            dedupeKey: `movie-subtitles-ready-v4:${input.assetId}:${ready.authority}`,
          },
          create: {
            dedupeKey: `movie-subtitles-ready-v4:${input.assetId}:${ready.authority}`,
            mediaId: input.scope.mediaId,
            kind: "movie_subtitles_ready_v4",
            payload: {
              schemaVersion: 4,
              scope: input.scope,
              assetId: input.assetId,
              recoveryEpoch: target.recoveryEpoch,
              targetAuthority: ready.authority,
            },
          },
          update: {},
        });
      const notices = await queueReadyMovieCaptionNoticesV4(
        tx,
        {
          scope: input.scope,
          assetId: input.assetId,
          epoch: target.recoveryEpoch,
          access,
        },
        budget,
      );
      for (const guard of notices.guards) guard.assertActive();
      freshness.assertActive();
    },
    { timeout: 60_000 },
  );
  execution.assertActive();
  execution.signal.throwIfAborted();
}

async function subtitleVideoGrant(
  tx: Transaction,
  input: Pick<MovieSubtitleInstallV4, "scope" | "assetId">,
  budget: PublicationAuthorityReadBudget,
) {
  const physical = await snapshotMoviePublicationAssetV2(
    tx,
    input.scope,
    input.assetId,
    budget,
  );
  const publication = await findMoviePublicationReferenceV2(
    tx,
    { scope: input.scope, asset: physical },
    budget,
  );
  if (publication === null)
    throw new FileGuardError("subtitle_physical_publication_missing");
  return publication;
}
