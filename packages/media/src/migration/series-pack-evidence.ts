import { MediaError } from "#application/errors.ts";
import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import { SeriesPackResolvedEvidenceV1Schema } from "#domain/resolved-evidence.ts";
import type { ParsedScene } from "#domain/resolved-parser.ts";
import { parseResolvedSeriesPackSceneV1 } from "#domain/acquisition-identity/series-pack-scene.ts";
import type { SeriesSeasonSetV1 } from "#shared/acquisition/series-pack-v1.ts";
import type { EvidenceInput } from "./runtime-evidence.ts";

export function prepareSeriesPackResolvedEvidenceV1(
  profile: ResolvedProfile,
  input: EvidenceInput,
  range: SeriesSeasonSetV1,
) {
  return seriesPackResolvedEvidenceV1(
    profile,
    input,
    parseResolvedSeriesPackSceneV1(profile, input.title, range),
  );
}

/** Only the new grammar supplies ParsedScene; original prepareResolvedEvidence remains literal. */
export function seriesPackResolvedEvidenceV1(
  profile: ResolvedProfile,
  input: EvidenceInput,
  parsed: ParsedScene,
) {
  if (profile.source !== "sonarr")
    throw new MediaError(
      "series_pack_quality_source_required",
      "A series pack needs its actual Sonarr policy source",
      409,
    );
  return SeriesPackResolvedEvidenceV1Schema.parse({
    schemaVersion: 1,
    source: profile.source,
    sourceVersion: profile.sourceVersion,
    parserVersion: "scene-series-pack-v1",
    release: {
      id: input.id,
      qualityId: parsed.qualityId,
      identityConfirmed: input.identityConfirmed,
      releaseTitle: parsed.releaseTitle,
      releaseGroup: parsed.releaseGroup,
      revision: parsed.revision,
      filename: input.filename ?? "",
      sizeBytes: input.sizeBytes,
      runtimeMinutes: input.runtimeMinutes,
      originalLanguage: input.originalLanguage,
      audioLanguages: input.audioLanguages,
      specialEpisode: input.specialEpisode,
    },
    protectedReasons: parsed.reasons,
    regex: { engine: "dotnet-ignorecase", culture: "en-US", observations: [] },
  });
}
