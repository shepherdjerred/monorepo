import type {
  FormatSpecification,
  ResolvedProfile,
  ResolvedRelease,
} from "#domain/resolved-contract.ts";
import {
  ResolvedEvidenceSchema,
  type ResolvedEvidence,
} from "#domain/resolved-evidence.ts";
import { parseResolvedScene } from "#domain/resolved-parser.ts";
import { runRegexMatcher } from "./regex-process.ts";

export type EvidenceInput = {
  id: string;
  title: string;
  filename?: string;
  identityConfirmed: boolean;
  sizeBytes: number;
  runtimeMinutes: number | null;
  originalLanguage: string | null;
  audioLanguages: string[] | null;
  specialEpisode: boolean;
};
export function prepareResolvedEvidence(
  profile: ResolvedProfile,
  input: EvidenceInput,
): ResolvedEvidence {
  const parsed = parseResolvedScene(profile, input.title);
  const release: ResolvedRelease = {
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
  };
  return ResolvedEvidenceSchema.parse({
    schemaVersion: 1,
    source: profile.source,
    sourceVersion: profile.sourceVersion,
    parserVersion: "scene-v1",
    release,
    protectedReasons: parsed.reasons,
    regex: { engine: "dotnet-ignorecase", culture: "en-US", observations: [] },
  });
}
export function regexRequests(
  profile: ResolvedProfile,
  release: ResolvedRelease,
): { pattern: string; value: string }[] {
  const requests = new Map<string, { pattern: string; value: string }>();
  const scored = new Set(
    profile.profile.formatItems
      .filter((item) => item.score !== 0)
      .map((item) => item.format),
  );
  for (const format of profile.customFormats.filter((item) =>
    scored.has(item.id),
  )) {
    for (const spec of format.specifications) {
      for (const request of specificationRequests(spec, release))
        requests.set(JSON.stringify([request.pattern, request.value]), request);
    }
  }
  return [...requests.values()];
}
function specificationRequests(
  spec: FormatSpecification,
  release: ResolvedRelease,
) {
  const pattern = spec.fields.length === 1 ? spec.fields[0]?.value : undefined;
  if (typeof pattern !== "string") return [];
  const values =
    spec.implementation === "ReleaseTitleSpecification"
      ? [release.releaseTitle, release.filename]
      : spec.implementation === "ReleaseGroupSpecification"
        ? [release.releaseGroup]
        : [];
  return values.flatMap((value) =>
    value === null ? [] : [{ pattern, value }],
  );
}
/** Production invokes only the packaged self-contained executable; no live compilation. */
export async function collectResolvedEvidence(
  profile: ResolvedProfile,
  evidence: ResolvedEvidence,
  executable = "/opt/media-regex/RegexOracle",
): Promise<ResolvedEvidence> {
  const requests = regexRequests(profile, evidence.release);
  if (requests.length === 0 || evidence.protectedReasons.length > 0)
    return evidence;
  const result = await runRegexMatcher([executable], requests);
  const requested = new Set(
    requests.map((item) => JSON.stringify([item.pattern, item.value])),
  );
  if (
    result.observations.length !== requested.size ||
    result.observations.some(
      (item) => !requested.delete(JSON.stringify([item.pattern, item.value])),
    ) ||
    requested.size > 0
  )
    throw new Error("Regex response does not match request");
  return ResolvedEvidenceSchema.parse({ ...evidence, regex: result });
}
