import type { DefaultAcquisitionIdentity } from "#shared/acquisition/library-management.ts";
import type { DefaultFileIdentityEvidence } from "#shared/acquisition/tv-file-evidence-v2.ts";
import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import {
  prepareResolvedEvidence,
  type EvidenceInput,
} from "#migration/runtime-evidence.ts";
import { seriesPackResolvedEvidenceV1 } from "#migration/series-pack-evidence.ts";
import { parseResolvedSeriesPackMemberV1 } from "#domain/acquisition-identity/series-pack-scene.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError } from "#automation/files/types.ts";

export type SeriesPackMeasurementV1 = {
  identity: DefaultAcquisitionIdentity;
  file: DefaultFileIdentityEvidence;
};

export function seriesPackMeasurementV1(
  identity: DefaultAcquisitionIdentity | null,
  file: DefaultFileIdentityEvidence | undefined,
) {
  return file !== undefined &&
    identity !== null &&
    "seriesPackV1" in identity.source
    ? { seriesPack: { identity, file } }
    : {};
}

export function prepareFileResolvedEvidenceV1(
  profile: ResolvedProfile,
  input: EvidenceInput,
  scope: {
    seriesPack: SeriesPackMeasurementV1 | undefined;
    mediaIds: readonly string[];
  },
) {
  return scope.seriesPack === undefined
    ? prepareResolvedEvidence(profile, input)
    : prepareMeasuredSeriesPackEvidenceV1(profile, input, {
        ...scope.seriesPack,
        mediaIds: scope.mediaIds,
      });
}

/** The current attempt was authorized before probing; its exact immutable identity and observed member remain bound here. */
export function prepareMeasuredSeriesPackEvidenceV1(
  profile: ResolvedProfile,
  input: EvidenceInput,
  scope: SeriesPackMeasurementV1 & { mediaIds: readonly string[] },
) {
  const { identity, file } = scope;
  if (
    !("seriesPackV1" in identity.source) ||
    identity.canonical.kind !== "series" ||
    identity.source.releaseId !== input.id ||
    file.attemptIdentityHash !== identityHash(identity) ||
    file.numberingDigest !== identity.canonical.coordinates.digest ||
    file.sourceFile.relativePath.split("/").at(-1) !== input.filename ||
    file.sourceFile.sizeBytes !== String(input.sizeBytes) ||
    identityHash([...file.coverage].sort()) !==
      identityHash([...scope.mediaIds].sort())
  )
    throw new FileGuardError("series_pack_member_evidence_changed");
  const sourceEvidence =
    identity.source.seriesPackV1.attributes.resolvedEvidence;
  if (
    sourceEvidence?.parserVersion !== "scene-series-pack-v1" ||
    sourceEvidence.release.releaseTitle !==
      input.title.replace(/\.(?:mkv|mp4|avi|m4v)$/iu, "")
  )
    throw new FileGuardError("series_pack_source_quality_changed");
  const parsed = parseResolvedSeriesPackMemberV1(profile, {
    filename: input.filename ?? "",
    releaseTitle: input.title,
    coordinates: identity.canonical.coordinates,
    coverage: file.coverage,
  });
  const declared = profile.qualityDefinitions.find(
    (entry) => entry.quality.id === sourceEvidence.release.qualityId,
  )?.quality;
  const member = profile.qualityDefinitions.find(
    (entry) => entry.quality.id === parsed.qualityId,
  )?.quality;
  if (
    declared !== undefined &&
    member !== undefined &&
    (declared.source !== member.source || declared.modifier !== member.modifier)
  )
    throw new FileGuardError("series_pack_member_quality_conflict");
  return seriesPackResolvedEvidenceV1(profile, input, parsed);
}
