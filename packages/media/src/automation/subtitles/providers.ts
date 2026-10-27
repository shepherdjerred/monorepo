import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { IntegrationError } from "#integrations/http.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import {
  fromAssrt,
  fromOpenSubtitles,
  type SubtitleSearch,
  type SubtitleSource,
} from "#automation/subtitle-sources.ts";
import {
  fromSubhd,
  fromZimuku,
  type SubtitleLookup,
} from "#automation/subtitle-browser-sources.ts";

export type SubtitleSourceLoader = (
  context: MediaAutomationContext,
  input: SubtitleSearch,
) => Promise<SubtitleLookup>;
export const defaultSources: Readonly<Record<string, SubtitleSourceLoader>> = {
  opensubtitles: fromOpenSubtitles,
  assrt: fromAssrt,
  subhd: fromSubhd,
  zimuku: fromZimuku,
};

/** Provider quotas and leases are shared by every edition and subtitle consumer. */
export async function withProvider(
  context: MediaAutomationContext,
  id: string,
  input: SubtitleSearch,
  source: SubtitleSourceLoader,
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

export function validateProviderSubtitle(
  source: SubtitleSource,
  simplified: boolean,
) {
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

type LookupResult = Awaited<
  ReturnType<MediaNetworkActivities["findMediaSubtitles"]>
>;

/** Shared adapters, provider ordering, quota handling and uncertain-download behavior. */
export async function searchSubtitleProviders(
  context: MediaAutomationContext,
  query: SubtitleSearch,
  sources: Readonly<Record<string, SubtitleSourceLoader>>,
  persist: (
    source: SubtitleSource,
    providerId: string,
  ) => Promise<LookupResult>,
): Promise<LookupResult> {
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
      return await subtitleProviderResult(result, persist, id);
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      await context.db.mediaProvider.update({
        where: { id },
        data: { lastError: error.kind },
      });
      if (error.kind === "outcome-unknown")
        return {
          status: "blocked",
          subtitleId: null,
          reason: "subtitle_download_outcome_unknown",
        };
      failure = error.kind;
    }
  }
  return {
    status: "waiting",
    subtitleId: null,
    reason:
      failure ??
      (providers.length === 0
        ? "subtitle_providers_not_configured"
        : "matching_subtitles_not_found"),
  };
}

function subtitleProviderResult(
  result: Exclude<SubtitleLookup, null>,
  persist: (
    source: SubtitleSource,
    providerId: string,
  ) => Promise<LookupResult>,
  providerId: string,
): Promise<LookupResult> {
  return "pending" in result
    ? Promise.resolve({
        status: "waiting",
        subtitleId: null,
        reason: "subtitle_browser_pending",
      })
    : persist(result, providerId);
}
