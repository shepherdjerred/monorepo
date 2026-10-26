import type { MediaAutomationContext } from "#automation/context.ts";
import { persistCandidateSnapshot } from "#automation/candidate-evidence.ts";
import { KnabenProvider } from "#integrations/providers.ts";
import { matchMovieReleaseV4 } from "#domain/editions/release-v4.ts";
import { cutCanonical } from "#infrastructure/editions/cut-context.ts";
import { providerMovieCutV2 } from "#infrastructure/movie-editions/cut-v2.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { QualityRulesSchema } from "#shared/api.ts";

/** Actual adapter, parser, policy and encrypted snapshot producer; only provider HTTP is synthetic. */
export async function retainedMovieCandidate(
  context: MediaAutomationContext,
  input: {
    media: { id: string; title: string; year: number | null };
    profile: { id: string; version: number; rules: unknown };
    source: {
      infoHash: string;
      sizeBytes: number;
      detailsUrl: string;
      download: { value: string };
    };
  },
) {
  const providerReleaseId = crypto.randomUUID();
  const provider = new KnabenProvider(() =>
    Promise.resolve(
      Response.json({
        hits: [
          {
            id: providerReleaseId,
            title: `${input.media.title}.${String(input.media.year)}.Extended.Cut.1080p.WEB-DL.H264.ENG`,
            bytes: input.source.sizeBytes,
            hash: input.source.infoHash,
            seeders: 5,
            details: input.source.detailsUrl,
            magnetUrl: input.source.download.value,
          },
        ],
      }),
    ),
  );
  const sources = await provider.search({
    query: input.media.title,
    kind: "movie",
    page: 1,
  });
  const source = sources[0];
  if (source === undefined || sources.length !== 1)
    throw new Error("Synthetic adapter omitted its candidate");
  const id = crypto.randomUUID();
  const canonical = await cutCanonical(context.db, [input.media.id]);
  const editionEvidence = providerMovieCutV2(id, source, canonical);
  const parsed = matchMovieReleaseV4(
    {
      id,
      providerId: source.providerId,
      title: source.title,
      sizeBytes: source.sizeBytes,
      media: { ...input.media, kind: "movie" },
      knownEpisodes: [],
    },
    editionEvidence,
  );
  const profile = {
    id: input.profile.id,
    version: input.profile.version,
    ...QualityRulesSchema.parse(input.profile.rules),
  };
  const evaluation = chooseUpgrade({
    candidate: parsed.attributes,
    current: null,
    profile,
    mediaIds: [input.media.id],
  });
  if (!evaluation.upgrade)
    throw new Error(
      `Synthetic named release did not satisfy actual quality policy: ${JSON.stringify(evaluation.evaluation.reasons)}`,
    );
  const stored = await persistCandidateSnapshot(context, {
    source,
    attributes: parsed.attributes,
    evaluation: evaluation.evaluation,
    searchedForMediaId: input.media.id,
  });
  if (stored === null) throw new Error("Actual candidate snapshot conflicted");
  const release = await context.db.releaseCandidate.findUniqueOrThrow({
    where: { id: stored.id },
  });
  return { source, release };
}
