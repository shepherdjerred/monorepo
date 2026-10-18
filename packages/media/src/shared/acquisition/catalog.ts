import { z } from "zod";

export const CatalogReferenceSchema = z
  .strictObject({
    kind: z.enum(["movie", "series"]),
    namespace: z.enum(["tmdb", "imdb", "tvdb"]),
    value: z.string().min(1).max(100),
  })
  .refine(
    (reference) =>
      reference.namespace === "imdb"
        ? /^tt\d{7,10}$/u.test(reference.value)
        : /^[1-9]\d{0,14}$/u.test(reference.value),
    "Catalog identifier does not match its namespace",
  );
export const ProviderReferenceSchema = CatalogReferenceSchema.safeExtend({
  provenance: z.strictObject({
    kind: z.literal("provider-field"),
    field: z.string().min(1).max(100),
  }),
});
export const ProviderEditionEvidenceSchema = z.strictObject({
  text: z.string().min(1).max(500),
  provenance: z.strictObject({
    kind: z.enum(["provider-field", "release-title"]),
    field: z.string().min(1).max(100),
  }),
});
export const CatalogIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  references: z.array(CatalogReferenceSchema).max(20),
  originalTitle: z.string().max(500).nullable(),
  aliases: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(500),
        country: z.string().max(20),
        type: z.string().max(100),
        source: z.literal("tmdb"),
      }),
    )
    .max(500),
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type CatalogReference = z.infer<typeof CatalogReferenceSchema>;
export type CatalogIdentity = z.infer<typeof CatalogIdentitySchema>;
export type ProviderReference = z.infer<typeof ProviderReferenceSchema>;
export type ProviderEditionEvidence = z.infer<
  typeof ProviderEditionEvidenceSchema
>;
