import path from "node:path";
import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import {
  MovieSubtitleOperationV4Schema,
  movieSubtitleTargetV4,
  type MovieSubtitleOperationV4,
} from "#shared/movie-editions/subtitles-v4.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import {
  defaultSources,
  searchSubtitleProviders,
  validateProviderSubtitle,
  type SubtitleSourceLoader,
} from "#automation/subtitles/providers.ts";
import {
  subtitleMetadataMatches,
  regularDialogueRequirement,
  subtitleVersionMatches,
} from "#automation/subtitle-sources.ts";
import type { SubtitleSource } from "#domain/subtitle-maintenance/provider.ts";
import { isMachineLabelled } from "#integrations/subtitle-validation.ts";
import { evaluateSubtitle } from "#domain/subtitles.ts";
import { createHash } from "node:crypto";
import {
  findReusableSubtitleV1,
  subtitleUpgradeCurrentV1,
  subtitleCandidateWorkCurrentV1,
  subtitleScoreEvidenceV1,
  rejectedSubtitleChecksumsV1,
} from "#automation/subtitles/upgrade.ts";
import { subtitleScoreReferenceV1 } from "#infrastructure/subtitle-maintenance/reference.ts";
import {
  subtitleSourceDecisionV1,
  recordSubtitleSourceRejectionV1,
} from "#automation/subtitle-maintenance/source-policy.ts";
import { currentMovieSubtitleWorkV4 } from "./authority.ts";
import { assertMovieSubtitleOperationV4 } from "./operation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { refreshMovieScopeRequestersV4 } from "#automation/movie-editions/requester-access.ts";

type Result = Awaited<ReturnType<MediaNetworkActivities["findMediaSubtitles"]>>;
const blocked = (reason: string): Result => ({
  status: "blocked",
  subtitleId: null,
  reason,
});
const obsolete = (): Result => ({
  status: "obsolete",
  subtitleId: null,
  reason: "subtitle_target_changed",
});

async function authorizedWork(
  context: MediaAutomationContext,
  input: MovieSubtitleOperationV4,
  budget: PublicationAuthorityReadBudget,
) {
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  return context.db.$transaction(async (tx) => {
    await lockMovieCommand(tx, input.scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [input.scope.mediaId],
    });
    if (!(await lockRuntimeAuthority(tx, input.recoveryEpoch))) return null;
    await lockSubtitlePolicies(tx);
    await assertMovieSubtitleOperationV4(tx, input);
    const work = await currentMovieSubtitleWorkV4(
      tx,
      {
        scope: input.scope,
        assetId: input.assetId,
        epoch: input.recoveryEpoch,
        access,
      },
      budget,
    );
    if (
      !subtitleCandidateWorkCurrentV1(
        work,
        movieSubtitleTargetV4(input),
        input.targetAuthority,
        input.upgradeV1,
      )
    )
      return null;
    const execution = context.plexBindingExecution();
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: Math.min(execution.expiresAtMs, work.freshness.expiresAtMs),
      guards: [execution, work.freshness],
    });
    freshness.assertActive();
    return { ...work, freshness };
  });
}

async function persist(
  context: MediaAutomationContext,
  input: MovieSubtitleOperationV4,
  {
    source,
    providerId,
    originalFreshness,
  }: {
    source: SubtitleSource;
    providerId: string;
    originalFreshness: { assertActive: () => void };
  },
  budget: PublicationAuthorityReadBudget,
): Promise<Result> {
  originalFreshness.assertActive();
  if (!subtitleMetadataMatches(movieSubtitleTargetV4(input), source, true))
    return blocked("subtitle_target_metadata_unproven");
  const validated = validateProviderSubtitle(
    source,
    ["zh-Hans", "zh-CN"].includes(input.language),
  );
  if (validated === null) return blocked("subtitle_content_requires_review");
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  return context.db.$transaction(async (tx) => {
    await lockMovieCommand(tx, input.scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [input.scope.mediaId],
    });
    if (
      !(await lockRuntimeAuthority(tx, input.recoveryEpoch)) ||
      !(await context.gates.acquisition())
    )
      return obsolete();
    await lockSubtitlePolicies(tx);
    await assertMovieSubtitleOperationV4(tx, input);
    const work = await currentMovieSubtitleWorkV4(
      tx,
      {
        scope: input.scope,
        assetId: input.assetId,
        epoch: input.recoveryEpoch,
        access,
      },
      budget,
    );
    originalFreshness.assertActive();
    if (
      !subtitleCandidateWorkCurrentV1(
        work,
        movieSubtitleTargetV4(input),
        input.targetAuthority,
        input.upgradeV1,
      )
    )
      return obsolete();
    const existing = findReusableSubtitleV1(
      work,
      input.recoveryEpoch,
      movieSubtitleTargetV4(input),
      input.upgradeV1,
    );
    if (existing !== undefined)
      return { status: "found", subtitleId: existing.id, reason: null };
    const reference = subtitleScoreReferenceV1(work.asset);
    const decision = subtitleSourceDecisionV1(source, {
      language: input.language,
      ...(reference === null ? {} : { scoreReferenceV1: reference }),
      ...(input.upgradeV1 === undefined ? {} : { upgradeV1: input.upgradeV1 }),
      excludedChecksumsV1: rejectedSubtitleChecksumsV1(
        work,
        input.recoveryEpoch,
        reference,
      ),
    });
    if (!decision.accepted) {
      await recordSubtitleSourceRejectionV1(tx, {
        operationId: input.operationId,
        asset: work.asset,
        epoch: input.recoveryEpoch,
        providerId,
        language: input.language,
        source,
        decision,
      });
      return blocked(z.string().parse(decision.reason));
    }
    const evaluation = evaluateSubtitle({
      requestedLanguage: input.language,
      actualLanguage: source.actualLanguage,
      exactMediaMatch: true,
      videoVersionMatch: subtitleVersionMatches(
        source.filename,
        work.asset.sourcePath ?? "",
      ),
      machineLabelled: isMachineLabelled(source.description),
      traditionalOnlyCharacters: validated.traditionalEvidence,
      simplifiedOnlyCharacters: validated.simplifiedEvidence,
      minimumSimplifiedEvidence: 5,
    });
    if (!evaluation.accepted) return blocked(evaluation.reasons.join(","));
    if (work.target === null)
      throw new Error("Authorized movie subtitle target disappeared");
    const target = movieSubtitleTargetV4(input);
    const subtitle = await tx.subtitleAsset.create({
      data: {
        assetId: input.assetId,
        language: input.language,
        providerId,
        state: "validated",
        qualityStatus: "accepted",
        storageKind: "sidecar",
        ownershipEpoch: input.recoveryEpoch,
        checksum: createHash("sha256").update(validated.text).digest("hex"),
        videoChecksum: work.asset.checksum,
        videoVersion: work.asset.version,
        forced: source.forced,
        hearingImpaired: source.hearingImpaired,
        content: new TextEncoder().encode(validated.text),
        provenance: {
          filename: source.filename,
          description: source.description,
          format: validated.format,
          simplifiedEvidence: validated.simplifiedEvidence,
          traditionalEvidence: validated.traditionalEvidence,
        },
        matchingEvidence: {
          operationId: input.operationId,
          ...subtitleScoreEvidenceV1(source),
          ...regularDialogueRequirement(target, source),
          schemaVersion: 4,
          ...(source.catalogEvidenceV1 === undefined
            ? {}
            : { catalogEvidenceV1: source.catalogEvidenceV1 }),
          movieScope: input.scope,
          assetVersion: work.asset.version,
          assetChecksum: work.asset.checksum,
          exactMediaMatch: true,
          videoVersionMatch: true,
          recoveryEpoch: input.recoveryEpoch,
          targetAuthority: input.targetAuthority,
          target,
          generations: { [input.scope.mediaId]: work.target.generation },
        },
      },
    });
    work.freshness.assertActive();
    originalFreshness.assertActive();
    return { status: "found", subtitleId: subtitle.id, reason: null };
  });
}

/** Same real adapters and quotas as TV, with explicit edition operation and final scoped persistence. */
export async function findMovieSubtitlesV4(
  initial: MediaAutomationContext,
  raw: MovieSubtitleOperationV4,
  sources: Readonly<Record<string, SubtitleSourceLoader>> = defaultSources,
): Promise<Result> {
  const execution = initial.plexBindingExecution();
  execution.assertActive();
  const input = MovieSubtitleOperationV4Schema.parse(raw);
  const budget =
    initial.movieManagement?.budget ?? new PublicationAuthorityReadBudget();
  const context = {
    ...initial,
    plexBindingExecution: () => execution,
    movieManagement: { execution, budget },
  };
  if (!(await context.gates.acquisition()))
    return blocked("acquisition_disabled");
  await refreshMovieScopeRequestersV4(context, input.scope);
  const work = await authorizedWork(context, input, budget);
  if (work === null) return obsolete();
  if (
    !subtitleUpgradeCurrentV1(
      work,
      input.upgradeV1,
      movieSubtitleTargetV4(input),
    )
  )
    return obsolete();
  const existing = findReusableSubtitleV1(
    work,
    input.recoveryEpoch,
    movieSubtitleTargetV4(input),
    input.upgradeV1,
  );
  if (existing !== undefined)
    return { status: "found", subtitleId: existing.id, reason: null };
  const operation = await assertMovieSubtitleOperationV4(context.db, input);
  if (
    z.object({ subtitleDownload: z.unknown() }).safeParse(operation.result)
      .success
  )
    return blocked("subtitle_download_outcome_unknown");
  if (work.asset.sourcePath === null) return blocked("source_identity_missing");
  const coverage = work.asset.coverage[0];
  if (coverage === undefined)
    throw new Error("Authorized subtitle asset lost its exact movie coverage");
  const scoreReference = subtitleScoreReferenceV1(work.asset);
  return searchSubtitleProviders(
    context,
    {
      operationId: input.operationId,
      assetIdV1: work.asset.id,
      sourceFilename: path.basename(work.asset.sourcePath),
      query: coverage.media.title,
      ...(scoreReference === null ? {} : { scoreReferenceV1: scoreReference }),
      ...(input.upgradeV1 === undefined ? {} : { upgradeV1: input.upgradeV1 }),
      language: input.language,
      ...(input.forced === undefined ? {} : { forced: input.forced }),
      ...(input.hearingImpaired === undefined
        ? {}
        : { hearingImpaired: input.hearingImpaired }),
      downloadAuthority: {
        assertActive: work.freshness.assertActive,
        authorize: async () => {
          if (
            !(await context.gates.acquisition()) ||
            (await authorizedWork(context, input, budget)) === null
          )
            throw new FileGuardError("subtitle_target_changed");
          work.freshness.assertActive();
        },
      },
    },
    sources,
    (source, providerId) =>
      persist(
        context,
        input,
        { source, providerId, originalFreshness: work.freshness },
        budget,
      ),
  );
}
