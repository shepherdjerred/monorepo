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
  reusableSubtitle,
  targetRequired,
} from "#automation/subtitles/authority.ts";
import {
  defaultSources,
  searchSubtitleProviders,
  validateProviderSubtitle,
  type SubtitleSourceLoader,
} from "#automation/subtitles/providers.ts";
import {
  subtitleMetadataMatches,
  subtitleVersionMatches,
  type SubtitleSource,
} from "#automation/subtitle-sources.ts";
import { isMachineLabelled } from "#integrations/subtitle-validation.ts";
import { evaluateSubtitle } from "#domain/subtitles.ts";
import { createHash } from "node:crypto";
import { currentMovieSubtitleWorkV4 } from "./authority.ts";
import { assertMovieSubtitleOperationV4 } from "./operation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { FileGuardError } from "#automation/files/types.ts";

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
      work.protectedReasons.length > 0 ||
      work.authority !== input.targetAuthority ||
      !targetRequired(work, movieSubtitleTargetV4(input))
    )
      return null;
    work.freshness.assertActive();
    return work;
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
  if (!subtitleMetadataMatches(movieSubtitleTargetV4(input), source))
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
      work.protectedReasons.length > 0 ||
      work.authority !== input.targetAuthority ||
      !targetRequired(work, movieSubtitleTargetV4(input))
    )
      return obsolete();
    const existing = work.asset.subtitles.find((subtitle) =>
      reusableSubtitle(
        subtitle,
        work,
        input.recoveryEpoch,
        movieSubtitleTargetV4(input),
      ),
    );
    if (existing !== undefined)
      return { status: "found", subtitleId: existing.id, reason: null };
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
          schemaVersion: 4,
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
  context: MediaAutomationContext,
  raw: MovieSubtitleOperationV4,
  sources: Readonly<Record<string, SubtitleSourceLoader>> = defaultSources,
): Promise<Result> {
  const input = MovieSubtitleOperationV4Schema.parse(raw);
  const budget = new PublicationAuthorityReadBudget();
  if (!(await context.gates.acquisition()))
    return blocked("acquisition_disabled");
  const work = await authorizedWork(context, input, budget);
  if (work === null) return obsolete();
  const existing = work.asset.subtitles.find((subtitle) =>
    reusableSubtitle(
      subtitle,
      work,
      input.recoveryEpoch,
      movieSubtitleTargetV4(input),
    ),
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
  return searchSubtitleProviders(
    context,
    {
      operationId: input.operationId,
      sourceFilename: path.basename(work.asset.sourcePath),
      query: coverage.media.title,
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
