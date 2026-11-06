import { z } from "zod";
import {
  ResolvedReleaseSchema,
  type RegexMatcher,
} from "./resolved-contract.ts";

/** Internal persisted evidence, generated from the validated neutral subprocess protocol. */
export const ResolvedEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(["radarr", "sonarr"]),
  sourceVersion: z.string(),
  parserVersion: z.enum([
    "scene-v1",
    "scene-anime-v2",
    "scene-movie-v4",
    "handoff-v1",
  ]),
  release: ResolvedReleaseSchema,
  protectedReasons: z.array(z.string()),
  regex: z.object({
    engine: z.literal("dotnet-ignorecase"),
    culture: z.literal("en-US"),
    observations: z
      .array(
        z.object({
          pattern: z.string().max(8192),
          value: z.string().max(4096),
          result: z.enum(["match", "no_match", "unknown"]),
        }),
      )
      .max(10_000),
  }),
});
/** Original parser tags retain their literal schema; the new Sonarr pack grammar is independently versioned. */
export const SeriesPackResolvedEvidenceV1Schema = ResolvedEvidenceSchema.extend(
  {
    source: z.literal("sonarr"),
    parserVersion: z.literal("scene-series-pack-v1"),
  },
).strict();
export const ResolvedEvidenceProtocolSchema = z.union([
  ResolvedEvidenceSchema,
  SeriesPackResolvedEvidenceV1Schema,
]);
export type ResolvedEvidence = z.infer<typeof ResolvedEvidenceProtocolSchema>;
/** Current catalog facts are evaluation inputs; the retained measured evidence stays literal. */
export function projectResolvedCatalog(
  evidence: ResolvedEvidence,
  metadata: { runtimeMinutes: number | null; originalLanguage: string | null },
): ResolvedEvidence {
  return ResolvedEvidenceProtocolSchema.parse({
    ...evidence,
    release: { ...evidence.release, ...metadata },
  });
}
export function evidenceMatcher(
  evidence: readonly ResolvedEvidence[],
): RegexMatcher {
  const observations = new Map<string, "match" | "no_match" | "unknown">();
  for (const item of evidence.flatMap((entry) => entry.regex.observations)) {
    const key = JSON.stringify([item.pattern, item.value]);
    const previous = observations.get(key);
    if (previous !== undefined && previous !== item.result)
      throw new Error("Conflicting regex evidence");
    observations.set(key, item.result);
  }
  return (pattern, value) =>
    observations.get(JSON.stringify([pattern, value])) ?? "unknown";
}
