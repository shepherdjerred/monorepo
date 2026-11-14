import { z } from "zod";
import type {
  LibraryAsset,
  Operation,
  SubtitleAsset,
} from "#generated/prisma/client.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { fileMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import { publicationSubtitleSnapshot } from "#infrastructure/publication-proof/snapshots.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { assertMovieSubtitleOperationV4 } from "#automation/movie-editions/subtitles/operation.ts";
import { subtitleCandidateWorkCurrentV1 } from "#automation/subtitles/upgrade.ts";
import {
  MovieSubtitleOperationV4Schema,
  movieSubtitleTargetV4,
  type MovieSubtitleOperationV4,
} from "#shared/movie-editions/subtitles-v4.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Stored V4 commands supply exact cut authority; an asset label cannot create it. */
export function movieSubtitleSpeechOperation(
  operation: Pick<Operation, "id" | "kind" | "targetId" | "payload">,
  subtitle: SubtitleAsset,
) {
  if (operation.kind !== "acquire_movie_subtitles_v4") return null;
  const target = MovieSubtitleOperationV4Schema.parse(
    z.object(MovieSubtitleOperationV4Schema.shape).parse(operation.payload),
  );
  const evidence = z
    .record(z.string(), z.json())
    .parse(subtitle.matchingEvidence);
  if (
    target.operationId !== operation.id ||
    target.assetId !== operation.targetId ||
    target.assetId !== subtitle.assetId ||
    evidence["operationId"] !== operation.id ||
    evidence["schemaVersion"] !== 4 ||
    identityHash(evidence["movieScope"]) !== identityHash(target.scope) ||
    evidence["targetAuthority"] !== target.targetAuthority ||
    identityHash(evidence["target"]) !==
      identityHash(movieSubtitleTargetV4(target))
  )
    throw new FileGuardError("subtitle_operation_changed");
  return target;
}

/** Read-only candidate measurement retains the real V4 consent and target locks. */
export async function authorizeMovieSubtitleSpeechV4(
  context: FileContext,
  input: {
    target: MovieSubtitleOperationV4;
    subtitle: SubtitleAsset;
    asset: Pick<LibraryAsset, "id" | "path" | "version" | "checksum">;
    budget: PublicationAuthorityReadBudget;
    execution: PublicationExecution;
  },
) {
  const { target, subtitle, asset, budget, execution } = input;
  const access = requireMovieChoiceAccess(
    (await fileMovieAccess(context, [target.scope.mediaId])) ?? {},
  );
  execution.assertActive();
  return context.db.$transaction(async (tx) => {
    budget.consume(2);
    await lockMovieCommand(tx, target.scope);
    if (!(await lockRuntimeAuthority(tx, target.recoveryEpoch, budget)))
      throw new FileGuardError("runtime_protected");
    await lockSubtitlePolicies(tx);
    await assertNoSubtitleReplacement(tx, [target.assetId]);
    await tx.$queryRaw`SELECT id FROM "LibraryAsset" WHERE id=${target.assetId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "SubtitleAsset" WHERE id=${subtitle.id} FOR UPDATE`;
    await assertPublicationUnfenced(
      tx,
      [target.scope.mediaId],
      [target.assetId],
    );
    if (!(await context.enabled.acquisition()))
      throw new FileGuardError("acquisition_disabled");
    budget.consume(1);
    await assertMovieSubtitleOperationV4(tx, target);
    const work = await currentMovieSubtitleWorkV4(
      tx,
      {
        scope: target.scope,
        assetId: target.assetId,
        epoch: target.recoveryEpoch,
        access,
      },
      budget,
    );
    budget.consume(
      1 +
        work.asset.subtitles.length +
        work.asset.coverage.length * 2 +
        (work.target === null ? 0 : work.target.profile === null ? 1 : 2),
    );
    const current = work.asset.subtitles.find((row) => row.id === subtitle.id);
    if (
      current === undefined ||
      work.asset.id !== asset.id ||
      work.asset.path !== asset.path ||
      work.asset.version !== asset.version ||
      work.asset.checksum !== asset.checksum ||
      work.asset.version !== subtitle.videoVersion ||
      work.asset.checksum !== subtitle.videoChecksum ||
      work.asset.ownershipEpoch !== subtitle.ownershipEpoch ||
      !subtitleCandidateWorkCurrentV1(
        work,
        movieSubtitleTargetV4(target),
        target.targetAuthority,
        target.upgradeV1,
      ) ||
      identityHash(publicationSubtitleSnapshot(current)) !==
        identityHash(publicationSubtitleSnapshot(subtitle))
    )
      throw new FileGuardError("subtitle_speech_candidate_changed");
    const freshness = {
      expiresAtMs: Math.min(execution.expiresAtMs, work.freshness.expiresAtMs),
      assertActive: () => {
        execution.assertActive();
        execution.signal.throwIfAborted();
        work.freshness.assertActive();
      },
    };
    freshness.assertActive();
    return freshness;
  });
}
