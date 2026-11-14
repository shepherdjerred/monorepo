import nodePath from "node:path";
import {
  defaultIntent,
  defaultScope,
  assertDefaultEdition,
} from "#shared/editions/scope.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { createHash } from "node:crypto";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import {
  currentSubtitleWork,
  SubtitleWorkSchema,
} from "./subtitles/authority.ts";
import type { SubtitleTarget } from "#domain/subtitle-quality.ts";
import { z } from "zod";
import {
  runtimeAuthority,
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { isMachineLabelled } from "#integrations/subtitle-validation.ts";
import { evaluateSubtitle } from "#domain/subtitles.ts";
import type { MediaAutomationContext } from "./context.ts";
import {
  subtitleVersionMatches,
  subtitleMetadataMatches,
  regularDialogueRequirement,
} from "./subtitle-sources.ts";
import type {
  SubtitleSearch,
  SubtitleSource,
} from "#domain/subtitle-maintenance/provider.ts";
import {
  defaultSources,
  searchSubtitleProviders,
  validateProviderSubtitle,
  type SubtitleSourceLoader as Source,
} from "./subtitles/providers.ts";
import { serializable } from "./store.ts";
import type { SubtitleUpgradeV1 } from "#shared/subtitle-maintenance/score.ts";
import {
  findReusableSubtitleV1,
  subtitleCandidateWorkCurrentV1,
  subtitleScoreEvidenceV1,
  rejectedSubtitleChecksumsV1,
  assertSubtitleUpgradeOperationV1,
} from "./subtitles/upgrade.ts";
import { subtitleScoreReferenceV1 } from "#infrastructure/subtitle-maintenance/reference.ts";
import {
  subtitleSourceDecisionV1,
  recordSubtitleSourceRejectionV1,
} from "./subtitle-maintenance/source-policy.ts";

type Result = Awaited<ReturnType<MediaNetworkActivities["findMediaSubtitles"]>>;
type SubtitleAsset = Awaited<ReturnType<typeof loadAsset>>;
const blocked = (reason: string): Result => ({
  status: "blocked",
  subtitleId: null,
  reason,
});

async function loadAsset(context: MediaAutomationContext, assetId: string) {
  const asset = await context.db.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      coverage: {
        where: { current: true },
        include: {
          media: {
            include: {
              intents: { where: { edition: "default" } },
              parent: { include: { parent: true } },
            },
          },
        },
      },
    },
  });
  assertDefaultEdition(asset.edition);
  for (const coverage of asset.coverage) assertDefaultEdition(coverage.edition);
  return asset;
}

async function persist(
  context: MediaAutomationContext,
  asset: SubtitleAsset,
  source: SubtitleSource,
  selection: SubtitleTarget & {
    providerId: string;
    recoveryEpoch: number;
    targetAuthority: string;
    operationId: string;
    upgradeV1?: SubtitleUpgradeV1;
  },
): Promise<Result> {
  const { providerId, language, recoveryEpoch } = selection;
  const query = searchInput(asset, selection);
  if (query === null) return blocked("source_identity_missing");
  if (!subtitleMetadataMatches(selection, source, true))
    return blocked("subtitle_target_metadata_unproven");
  const simplified = ["zh-CN", "zh-Hans"].includes(language);
  const validation = validateProviderSubtitle(source, simplified);
  if (validation === null) return blocked("subtitle_content_requires_review");
  const validated = validation;
  const evaluation = evaluateSubtitle({
    requestedLanguage: language,
    actualLanguage: source.actualLanguage,
    exactMediaMatch: asset.owned && asset.coverage.length > 0,
    videoVersionMatch: subtitleVersionMatches(
      source.filename,
      asset.sourcePath ?? "",
    ),
    machineLabelled: isMachineLabelled(source.description),
    traditionalOnlyCharacters: validated.traditionalEvidence,
    simplifiedOnlyCharacters: validated.simplifiedEvidence,
    minimumSimplifiedEvidence: 5,
  });
  if (!evaluation.accepted) return blocked(evaluation.reasons.join(","));
  return await serializable(context.db, async (tx) => {
    const ids = asset.coverage.map((coverage) => coverage.mediaId).sort();
    await lockDefaultScopes(
      tx,
      ids.map((id) => defaultScope(id)),
      {
        createMissing: false,
      },
    );
    await lockEffectiveRequests(tx, ids);
    if (!(await lockRuntimeAuthority(tx, recoveryEpoch)))
      return blocked("runtime_protected");
    await lockSubtitlePolicies(tx);
    const work = await currentSubtitleWork(tx, asset.id, recoveryEpoch);
    if (
      !subtitleCandidateWorkCurrentV1(
        work,
        selection,
        selection.targetAuthority,
        selection.upgradeV1,
      )
    )
      return {
        status: "obsolete",
        subtitleId: null,
        reason: "subtitle_target_changed",
      };
    const existing = findReusableSubtitleV1(
      work,
      recoveryEpoch,
      selection,
      selection.upgradeV1,
    );
    if (existing !== undefined)
      return { status: "found", subtitleId: existing.id, reason: null };
    const decision = subtitleSourceDecisionV1(source, {
      ...query,
      excludedChecksumsV1: rejectedSubtitleChecksumsV1(
        work,
        recoveryEpoch,
        query.scoreReferenceV1,
      ),
    });
    if (!decision.accepted) {
      await recordSubtitleSourceRejectionV1(tx, {
        operationId: selection.operationId,
        asset: work.asset,
        epoch: recoveryEpoch,
        providerId,
        language,
        source,
        decision,
      });
      return blocked(z.string().parse(decision.reason));
    }
    const current = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: asset.id },
      include: { coverage: { where: { current: true } } },
    });
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed ||
      runtime.recoveryEpoch !== recoveryEpoch ||
      current.version !== asset.version ||
      current.checksum !== asset.checksum ||
      current.state !== "published" ||
      current.edition !== "default" ||
      current.coverage.length !== ids.length ||
      current.coverage.some(
        (coverage) =>
          coverage.edition !== "default" || !ids.includes(coverage.mediaId),
      )
    )
      return { status: "obsolete", subtitleId: null, reason: "asset_changed" };
    const intents = await tx.mediaIntent.findMany({
      where: { mediaId: { in: ids }, edition: "default" },
    });
    const generations = Object.fromEntries(
      asset.coverage.map((coverage) => [
        coverage.mediaId,
        defaultIntent(coverage.media.intents)?.generation,
      ]),
    );
    if (
      intents.length !== ids.length ||
      intents.some(
        (intent) =>
          !intent.desiredPresence ||
          intent.automationEpoch !== recoveryEpoch ||
          intent.generation !== generations[intent.mediaId],
      )
    )
      return { status: "obsolete", subtitleId: null, reason: "intent_changed" };
    const subtitle = await tx.subtitleAsset.create({
      data: {
        assetId: asset.id,
        language,
        providerId,
        state: "validated",
        qualityStatus: "accepted",
        ownershipEpoch: runtime.recoveryEpoch,
        storageKind: "sidecar",
        checksum: createHash("sha256").update(validated.text).digest("hex"),
        videoChecksum: asset.checksum,
        videoVersion: asset.version,
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
          operationId: selection.operationId,
          ...subtitleScoreEvidenceV1(source),
          ...regularDialogueRequirement(selection, source),
          assetVersion: asset.version,
          ...(source.catalogEvidenceV1 === undefined
            ? {}
            : { catalogEvidenceV1: source.catalogEvidenceV1 }),
          assetChecksum: asset.checksum,
          exactMediaMatch: true,
          videoVersionMatch: true,
          recoveryEpoch: runtime.recoveryEpoch,
          targetAuthority: selection.targetAuthority,
          target: {
            language,
            ...(selection.forced === undefined
              ? {}
              : { forced: selection.forced }),
            ...(selection.hearingImpaired === undefined
              ? {}
              : { hearingImpaired: selection.hearingImpaired }),
          },
          generations: Object.fromEntries(
            intents.map((intent) => [intent.mediaId, intent.generation]),
          ),
        },
      },
    });
    return { status: "found", subtitleId: subtitle.id, reason: null };
  });
}

function searchInput(
  asset: SubtitleAsset,
  input: SubtitleTarget & {
    operationId: string;
    upgradeV1?: SubtitleUpgradeV1;
  },
): SubtitleSearch | null {
  const media = asset.coverage[0]?.media;
  if (media === undefined || asset.sourcePath === null) return null;
  const scoreReference = subtitleScoreReferenceV1(asset);
  return {
    operationId: input.operationId,
    assetIdV1: asset.id,
    sourceFilename: nodePath.basename(asset.sourcePath),
    query: media.title,
    ...(input.upgradeV1 === undefined ? {} : { upgradeV1: input.upgradeV1 }),
    ...(scoreReference === null ? {} : { scoreReferenceV1: scoreReference }),
    language: input.language,
    ...(input.forced === undefined ? {} : { forced: input.forced }),
    ...(input.hearingImpaired === undefined
      ? {}
      : { hearingImpaired: input.hearingImpaired }),
    ...(media.seasonNumber === null ? {} : { season: media.seasonNumber }),
    ...(media.episodeNumber === null ? {} : { episode: media.episodeNumber }),
  };
}

async function search(
  context: MediaAutomationContext,
  asset: SubtitleAsset,
  input: SubtitleTarget & {
    operationId: string;
    assetId: string;
    language: string;
    recoveryEpoch: number;
    targetAuthority: string;
    upgradeV1?: SubtitleUpgradeV1;
  },
  sources: Readonly<Record<string, Source>>,
): Promise<Result> {
  const query = searchInput(asset, input);
  return query === null
    ? blocked("source_identity_missing")
    : searchSubtitleProviders(context, query, sources, (source, providerId) =>
        persist(context, asset, source, { ...input, providerId }),
      );
}

export function createSubtitleActivities(
  context: MediaAutomationContext,
  sources: Readonly<Record<string, Source>> = defaultSources,
): Pick<MediaNetworkActivities, "findMediaSubtitles"> {
  return {
    async findMediaSubtitles(input) {
      z.string()
        .regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/u)
        .parse(input.language);
      if (!(await context.gates.acquisition()))
        return blocked("acquisition_disabled");
      const runtime = await context.db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      if (runtime.mode !== "active" || !runtime.ownershipConfirmed)
        return blocked("runtime_protected");
      const authority = await runtimeAuthority(context.db);
      if (!authority.active) return blocked("runtime_protected");
      const asset = await loadAsset(context, input.assetId);
      if (
        !(await recordsAuthorized(context.db, {
          epoch: runtime.recoveryEpoch,
          mediaIds: asset.coverage.map((item) => item.mediaId),
          assetIds: [asset.id],
        }))
      )
        return blocked("record_ownership_unconfirmed");
      if (
        !asset.owned ||
        asset.checksum === null ||
        asset.state !== "published" ||
        asset.coverage.length === 0
      )
        return {
          status: "obsolete",
          subtitleId: null,
          reason: "asset_not_current",
        };
      SubtitleWorkSchema.parse(input);
      const target: SubtitleTarget = {
        language: input.language,
        ...(input.forced === undefined ? {} : { forced: input.forced }),
        hearingImpaired: input.hearingImpaired ?? "any",
      };
      const work = await currentSubtitleWork(
        context.db,
        asset.id,
        runtime.recoveryEpoch,
      );
      if (work.protectedReasons.length > 0)
        return blocked(work.protectedReasons.join(","));
      if (
        !subtitleCandidateWorkCurrentV1(
          work,
          target,
          input.targetAuthority ?? work.authority,
          input.upgradeV1,
        )
      )
        return {
          status: "obsolete",
          subtitleId: null,
          reason: "subtitle_target_changed",
        };
      const operation = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      assertSubtitleUpgradeOperationV1(operation.payload, input);
      const birth = z
        .object({ recoveryEpoch: z.number().int().nonnegative() })
        .safeParse(operation.payload);
      if (!birth.success || birth.data.recoveryEpoch !== runtime.recoveryEpoch)
        return {
          status: "obsolete",
          subtitleId: null,
          reason: "subtitle_operation_epoch_changed",
        };
      const accepted = findReusableSubtitleV1(
        work,
        runtime.recoveryEpoch,
        target,
        input.upgradeV1,
      );
      if (accepted !== undefined)
        return { status: "found", subtitleId: accepted.id, reason: null };
      return z
        .object({ subtitleDownload: z.unknown() })
        .safeParse(operation.result).success
        ? blocked("subtitle_download_outcome_unknown")
        : await search(
            context,
            asset,
            {
              ...input,
              ...target,
              targetAuthority: work.authority,
              recoveryEpoch: runtime.recoveryEpoch,
            },
            sources,
          );
    },
  };
}
