import { z } from "zod";
import { QualityRulesSchema } from "#shared/api.ts";
import { ProviderEditionEvidenceSchema } from "#shared/acquisition/catalog.ts";

const Key = z.string().regex(/^[\w-]{1,100}$/u);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Text = z.string().min(1).max(4096);
const Ids = z
  .array(Key)
  .max(10_000)
  .refine((value) => new Set(value).size === value.length);
const Artifact = z.strictObject({
  path: z
    .string()
    .min(1)
    .max(1000)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.includes("\\") &&
        value
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== ".."),
    ),
  sha256: Hash,
});
export const CorpusProvenanceSchema = z.strictObject({
  kind: z.enum(["synthetic", "captured"]),
  source: z.string().min(1).max(100),
  sourceVersion: z.string().min(1).max(100),
  capturedAt: z.iso.datetime(),
  sanitization: z.literal("allowlisted-boundaries-v1"),
  notes: z.string().min(1).max(1000),
});
export const CorpusManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    corpusId: Key,
    cases: z
      .array(
        z.strictObject({
          id: Key,
          input: Artifact,
          labels: Artifact,
          provenance: CorpusProvenanceSchema,
          profile: z.discriminatedUnion("kind", [
            z.strictObject({
              kind: z.literal("native_rules"),
              artifact: Artifact,
              provenance: CorpusProvenanceSchema,
            }),
            z.strictObject({
              kind: z.literal("source_snapshot"),
              artifact: Artifact,
              source: z.enum(["radarr", "sonarr"]),
              profileId: z.int().positive(),
              provenance: CorpusProvenanceSchema,
            }),
          ]),
        }),
      )
      .min(1)
      .max(100_000),
  })
  .refine(
    (value) =>
      new Set(value.cases.map((item) => item.id)).size === value.cases.length,
    "Duplicate corpus case",
  );

const Identity = z.strictObject({
  key: Key,
  kind: z.enum(["movie", "series", "season", "episode"]),
  title: Text,
  year: z.int().min(1800).max(2200).nullable(),
  tmdbId: z.int().positive().nullable(),
  parentKey: Key.nullable(),
  seasonNumber: z.int().nonnegative().nullable(),
  episodeNumber: z.int().nonnegative().nullable(),
  absoluteNumber: z.int().positive().nullable(),
  runtimeMinutes: z.number().positive().nullable(),
  originalLanguage: z.string().min(2).max(20).nullable(),
  aliases: z.array(Text).max(500),
  externalIds: z.partialRecord(
    z.enum(["tmdb", "tvdb", "imdb"]),
    z.string().min(1).max(100),
  ),
});
const Reference = z.strictObject({
  kind: z.enum(["movie", "series"]),
  namespace: z.enum(["tmdb", "tvdb", "imdb"]),
  value: z.string().min(1).max(100),
});
export const CorpusReleaseSchema = z.strictObject({
  key: Key,
  providerId: Key,
  title: Text,
  sizeBytes: z.int().positive(),
  references: z.array(Reference).max(20),
  // Optional only for existing corpus inputs. Present observations retain the
  // exact production provider fields, including an explicitly empty array.
  editionEvidence: z.array(ProviderEditionEvidenceSchema).max(20).optional(),
  members: z
    .array(
      z.strictObject({
        name: Text,
        sizeBytes: z.int().positive(),
        progress: z.number().min(0).max(1),
        // Literal ffprobe boundary JSON, parsed only by the production inspectMedia function.
        probe: z.json(),
      }),
    )
    .max(1000)
    .nullable(),
});
export const CorpusInputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    catalog: z.array(Identity).min(1).max(10_000),
    requestedKey: Key,
    current: CorpusReleaseSchema.nullable(),
    candidates: z.array(CorpusReleaseSchema).min(1).max(1000),
  })
  .refine((value) => {
    const keys = new Set(value.catalog.map((item) => item.key));
    return (
      keys.size === value.catalog.length &&
      keys.has(value.requestedKey) &&
      value.catalog.every(
        (item) => item.parentKey === null || keys.has(item.parentKey),
      ) &&
      new Set(value.candidates.map((item) => item.key)).size ===
        value.candidates.length &&
      !value.candidates.some((item) => item.key === value.current?.key)
    );
  }, "Catalog references and candidate identities must be distinct and complete");

export const CorpusNativeProfileSchema = z.strictObject({
  id: Key,
  version: z.int().positive(),
  rules: QualityRulesSchema,
});
export const CorpusPlanSchema = z.strictObject({
  sourceName: Text,
  coverage: Ids,
  libraryPath: Text,
});
export const CorpusLabelsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    authoredBy: z.enum(["human", "source-oracle", "synthetic-fixture-author"]),
    basis: z.string().min(1).max(2000),
    candidates: z
      .array(
        z.strictObject({
          key: Key,
          disposition: z.enum(["accept", "reject", "ambiguous", "unsupported"]),
          coverage: Ids,
          edition: z.enum([
            "standard_unmarked",
            "named",
            "ambiguous",
            "conflict",
          ]),
          plan: z.array(CorpusPlanSchema).max(100).nullable(),
        }),
      )
      .min(1)
      .max(1000),
    ranking: Ids.nullable(),
  })
  .refine(
    (value) =>
      new Set(value.candidates.map((item) => item.key)).size ===
      value.candidates.length,
  );

export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;
export type CorpusCase = CorpusManifest["cases"][number];
export type CorpusInput = z.infer<typeof CorpusInputSchema>;
export type CorpusRelease = z.infer<typeof CorpusReleaseSchema>;
export type CorpusLabels = z.infer<typeof CorpusLabelsSchema>;
export type CorpusPlan = z.infer<typeof CorpusPlanSchema>;
