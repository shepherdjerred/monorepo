import nodePath from "node:path";
import { z } from "zod";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { IntegrationError } from "#integrations/http.ts";
import {
  validateSubtitle,
  isMachineLabelled,
} from "#integrations/subtitle-validation.ts";
import { evaluateSubtitle } from "#domain/subtitles.ts";
import { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "./context.ts";
import {
  fromAssrt,
  fromOpenSubtitles,
  subtitleVersionMatches,
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
  return await context.db.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      coverage: {
        where: { current: true },
        include: { media: { include: { intent: true } } },
      },
    },
  });
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
  selection: { providerId: string; language: string; recoveryEpoch: number },
): Promise<Result> {
  const { providerId, language, recoveryEpoch } = selection;
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
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "MediaItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
    );
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
      current.coverage.length !== ids.length ||
      current.coverage.some((coverage) => !ids.includes(coverage.mediaId))
    )
      return { status: "obsolete", subtitleId: null, reason: "asset_changed" };
    const intents = await tx.mediaIntent.findMany({
      where: { mediaId: { in: ids } },
    });
    const generations = Object.fromEntries(
      asset.coverage.map((coverage) => [
        coverage.mediaId,
        coverage.media.intent?.generation,
      ]),
    );
    if (
      intents.length !== ids.length ||
      intents.some(
        (intent) =>
          !intent.desiredPresence ||
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
  input: { operationId: string; language: string },
): SubtitleSearch | null {
  const media = asset.coverage[0]?.media;
  if (media === undefined || asset.sourcePath === null) return null;
  return {
    operationId: input.operationId,
    sourceFilename: nodePath.basename(asset.sourcePath),
    query: media.title,
    language: input.language,
    ...(media.seasonNumber === null ? {} : { season: media.seasonNumber }),
    ...(media.episodeNumber === null ? {} : { episode: media.episodeNumber }),
  };
}

async function providerResult(
  context: MediaAutomationContext,
  asset: SubtitleAsset,
  result: Exclude<SubtitleLookup, null>,
  selection: { providerId: string; language: string; recoveryEpoch: number },
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
  input: {
    operationId: string;
    assetId: string;
    language: string;
    recoveryEpoch: number;
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
      return await providerResult(context, asset, result, {
        providerId: id,
        language: input.language,
        recoveryEpoch: input.recoveryEpoch,
      });
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
      const asset = await loadAsset(context, input.assetId);
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
      const existing = await context.db.subtitleAsset.findFirst({
        where: {
          assetId: asset.id,
          language: input.language,
          state: { in: ["validated", "installed"] },
        },
      });
      if (existing !== null)
        return { status: "found", subtitleId: existing.id, reason: null };
      const operation = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      return z
        .object({ subtitleDownload: z.unknown() })
        .safeParse(operation.result).success
        ? blocked("subtitle_download_outcome_unknown")
        : await search(
            context,
            asset,
            { ...input, recoveryEpoch: runtime.recoveryEpoch },
            sources,
          );
    },
  };
}
