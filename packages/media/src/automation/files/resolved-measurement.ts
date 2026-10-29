import type { ReleaseAttributes } from "#shared/contract.ts";
import type { FileContext } from "./types.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import {
  collectResolvedEvidence,
  prepareResolvedEvidence,
} from "#migration/runtime-evidence.ts";
import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import type { ResolvedEvidence } from "#domain/resolved-evidence.ts";

/** Run bounded external matching before any final PG lock or filesystem mutation. */
export async function measureResolvedEvidence(input: {
  context: FileContext;
  measured: ReleaseAttributes;
  filename: string;
}): Promise<void> {
  const { context, measured, filename } = input;
  const intents = await context.db.mediaIntent.findMany({
    where: { mediaId: { in: [...measured.mediaIds] }, edition: "default" },
    include: { profile: true, media: true },
  });
  for (const intent of intents) {
    if (intent.profile === null) continue;
    const profile = QualityRulesSchema.parse(intent.profile.rules).resolved;
    if (profile === undefined) continue;
    const prepared = prepareResolvedEvidence(profile, {
      id: measured.id,
      title: measured.title,
      filename,
      identityConfirmed: measured.identityConfidence === "exact",
      sizeBytes: measured.sizeBytes,
      runtimeMinutes: intents.every(
        (item) => item.media.runtimeMinutes !== null,
      )
        ? intents.reduce(
            (sum, item) => sum + (item.media.runtimeMinutes ?? 0),
            0,
          )
        : null,
      originalLanguage: intent.media.originalLanguage,
      audioLanguages:
        measured.audioLanguages.length === 0
          ? null
          : [...measured.audioLanguages],
      specialEpisode: intents.every((item) => item.media.seasonNumber === 0),
    });
    measureQuality(profile, prepared, measured.quality);
    const evidence = await collectResolvedEvidence(profile, prepared);
    const previous = measured.resolvedEvidence;
    if (
      previous !== undefined &&
      (previous.source !== evidence.source ||
        previous.sourceVersion !== evidence.sourceVersion)
    ) {
      evidence.protectedReasons.push("covered_profile_source_conflict");
    }
    // Multiple covered profiles may request different regex predicates over the same measured file.
    if (previous !== undefined) {
      const observations = new Map(
        [...previous.regex.observations, ...evidence.regex.observations].map(
          (item) => [JSON.stringify([item.pattern, item.value]), item],
        ),
      );
      evidence.regex.observations = [...observations.values()];
    }
    measured.resolvedEvidence = evidence;
  }
}
export function measureQuality(
  profile: ResolvedProfile,
  prepared: ResolvedEvidence,
  quality: string,
) {
  const original = profile.qualityDefinitions.find(
    (item) => item.quality.id === prepared.release.qualityId,
  )?.quality;
  if (original === undefined) {
    prepared.protectedReasons.push("measured_quality_unknown");
    return;
  }
  const resolution = /-(720|1080|2160|480)p$/u.exec(quality)?.[1];
  const matched = profile.qualityDefinitions.filter(
    (item) =>
      item.quality.resolution === Number(resolution) &&
      item.quality.source === original.source &&
      item.quality.modifier === original.modifier,
  );
  if (matched.length === 1 && matched[0] !== undefined)
    prepared.release.qualityId = matched[0].quality.id;
  else prepared.protectedReasons.push("measured_quality_unknown");
}
