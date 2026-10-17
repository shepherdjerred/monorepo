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
  targetRequired,
  reusableSubtitle,
} from "./subtitles/authority.ts";
import type { SubtitleTarget } from "#domain/subtitle-quality.ts";
import { z } from "zod";
import {
  runtimeAuthority,
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { IntegrationError } from "#integrations/http.ts";
import {
  validateSubtitle,
  isMachineLabelled,
} from "#integrations/subtitle-validation.ts";
import { evaluateSubtitle } from "#domain/subtitles.ts";
import type { MediaAutomationContext } from "./context.ts";
import {
  fromAssrt,
  fromOpenSubtitles,
  subtitleVersionMatches,
  subtitleMetadataMatches,
  type SubtitleSearch,
  type SubtitleSource,
} from "./subtitle-sources.ts";
import {
  fromSubhd,
  fromZimuku,
  type SubtitleLookup,
} from "./subtitle-browser-sources.ts";
import { serializable } from "./store.ts";

type Result = Awaited<ReturnType<MediaNetworkActivities["findMediaSubtitles"]>>;
type Source = (
  context: MediaAutomationContext,
  input: SubtitleSearch,
) => Promise<SubtitleLookup>;
type SubtitleAsset = Awaited<ReturnType<typeof loadAsset>>;
const defaultSources: Readonly<Record<string, Source>> = {
  opensubtitles: fromOpenSubtitles,
  assrt: fromAssrt,
  subhd: fromSubhd,
  zimuku: fromZimuku,
};
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
          media: { include: { intents: { where: { edition: "default" } } } },
        },
      },
    },
  });
  assertDefaultEdition(asset.edition);
  for (const coverage of asset.coverage) assertDefaultEdition(coverage.edition);
  return asset;
}

async function withProvider(
  context: MediaAutomationContext,
  id: string,
  input: SubtitleSearch,
  source: Source,
): Promise<SubtitleLookup> {
  const provider = await context.db.mediaProvider.findUniqueOrThrow({
    where: { id },
  });
  const policy = z
    .object({
      minimumIntervalSeconds: z.number().int().min(1).max(3600).default(30),
      dailyDownloadLimit: z.number().int().min(1).max(1000).default(10),
    })
    .parse(provider.configuration);
  const now = new Date();
  await context.db.providerLease.upsert({
    where: { providerId: id },
    create: { providerId: id, nextAllowedAt: now },
    update: {},
  });
  const ownerId = crypto.randomUUID();
  const claim = await context.db.providerLease.updateMany({
    where: {
      providerId: id,
      nextAllowedAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: { ownerId, leaseUntil: new Date(now.getTime() + 300_000) },
  });
  if (claim.count !== 1) throw new IntegrationError(id, "rate-limited");
  let delay = policy.minimumIntervalSeconds;
  try {
    const downloads = await context.db.applicationEvent.count({
      where: {
        kind: "subtitle_download_requested",
        createdAt: { gte: new Date(now.getTime() - 86_400_000) },
        payload: { path: ["providerId"], equals: id },
      },
    });
    if (downloads >= policy.dailyDownloadLimit)
      throw new IntegrationError(id, "rate-limited");
    return await source(context, input);
  } catch (error) {
    if (error instanceof IntegrationError)
      delay = Math.max(delay, error.retryAfterSeconds ?? 60);
    throw error;
  } finally {
    await context.db.providerLease.updateMany({
      where: { providerId: id, ownerId },
      data: {
        ownerId: null,
        leaseUntil: null,
        nextAllowedAt: new Date(Date.now() + delay * 1000),
      },
    });
  }
}

async function persist(
  context: MediaAutomationContext,
  asset: SubtitleAsset,
  source: SubtitleSource,
  selection: SubtitleTarget & {
    providerId: string;
    recoveryEpoch: number;
    targetAuthority: string;
  },
): Promise<Result> {
  const { providerId, language, recoveryEpoch } = selection;
  if (!subtitleMetadataMatches(selection, source))
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
      work.authority !== selection.targetAuthority ||
      work.protectedReasons.length > 0 ||
      !targetRequired(work, selection)
    )
      return {
        status: "obsolete",
        subtitleId: null,
        reason: "subtitle_target_changed",
      };
    const existing = work.asset.subtitles.find((subtitle) =>
      reusableSubtitle(subtitle, work, recoveryEpoch, selection),
    );
    if (existing !== undefined)
      return { status: "found", subtitleId: existing.id, reason: null };
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
          assetVersion: asset.version,
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

function validateProviderSubtitle(source: SubtitleSource, simplified: boolean) {
  try {
    return validateSubtitle({
      bytes: source.bytes,
      filename: source.filename,
      provenanceText: source.description,
      requireSimplified: simplified,
      ...(source.declaredEncoding === undefined
        ? {}
        : { declaredEncoding: source.declaredEncoding }),
    });
  } catch (error) {
    // This pure parser processes untrusted provider content; errors describe invalid subtitle input.
    if (error instanceof Error) return null;
    throw error;
  }
}

function searchInput(
  asset: SubtitleAsset,
  input: SubtitleTarget & { operationId: string },
): SubtitleSearch | null {
  const media = asset.coverage[0]?.media;
  if (media === undefined || asset.sourcePath === null) return null;
  return {
    operationId: input.operationId,
    sourceFilename: nodePath.basename(asset.sourcePath),
    query: media.title,
    language: input.language,
    ...(input.forced === undefined ? {} : { forced: input.forced }),
    ...(input.hearingImpaired === undefined
      ? {}
      : { hearingImpaired: input.hearingImpaired }),
    ...(media.seasonNumber === null ? {} : { season: media.seasonNumber }),
    ...(media.episodeNumber === null ? {} : { episode: media.episodeNumber }),
  };
}

async function providerResult(
  context: MediaAutomationContext,
  asset: SubtitleAsset,
  result: Exclude<SubtitleLookup, null>,
  selection: SubtitleTarget & {
    providerId: string;
    recoveryEpoch: number;
    targetAuthority: string;
  },
): Promise<Result> {
  return "pending" in result
    ? {
        status: "waiting",
        subtitleId: null,
        reason: "subtitle_browser_pending",
      }
    : await persist(context, asset, result, selection);
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
  },
  sources: Readonly<Record<string, Source>>,
): Promise<Result> {
  const query = searchInput(asset, input);
  if (query === null) return blocked("source_identity_missing");
  const providers = await context.db.mediaProvider.findMany({
    where: { id: { in: Object.keys(sources) }, enabled: true },
  });
  let failure: string | null = null;
  for (const id of ["opensubtitles", "assrt", "subhd", "zimuku"]) {
    const source = sources[id];
    if (
      source === undefined ||
      !providers.some((provider) => provider.id === id)
    )
      continue;
    try {
      const result = await withProvider(context, id, query, source);
      if (result === null) continue;
      const outcome = await providerResult(context, asset, result, {
        ...input,
        providerId: id,
        language: input.language,
        recoveryEpoch: input.recoveryEpoch,
      });
      return outcome;
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      await context.db.mediaProvider.update({
        where: { id },
        data: { lastError: error.kind },
      });
      if (error.kind === "outcome-unknown")
        return blocked("subtitle_download_outcome_unknown");
      failure = error.kind;
    }
  }
  const missing =
    providers.length === 0
      ? "subtitle_providers_not_configured"
      : "matching_subtitles_not_found";
  return { status: "waiting", subtitleId: null, reason: failure ?? missing };
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
        !targetRequired(work, target) ||
        (input.targetAuthority !== undefined &&
          input.targetAuthority !== work.authority)
      )
        return {
          status: "obsolete",
          subtitleId: null,
          reason: "subtitle_target_changed",
        };
      const operation = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      const birth = z
        .object({ recoveryEpoch: z.number().int().nonnegative() })
        .safeParse(operation.payload);
      if (!birth.success || birth.data.recoveryEpoch !== runtime.recoveryEpoch)
        return {
          status: "obsolete",
          subtitleId: null,
          reason: "subtitle_operation_epoch_changed",
        };
      const accepted = work.asset.subtitles.find((subtitle) =>
        reusableSubtitle(subtitle, work, runtime.recoveryEpoch, target),
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
