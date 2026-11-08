import { z } from "zod";

export const CutKindSchema = z.enum([
  "directors_cut",
  "extended_cut",
  "theatrical_cut",
  "final_cut",
  "unrated_cut",
  "uncut_version",
]);
export const CutReasonSchema = z.enum([
  "edition_candidate_incompatible",
  "edition_evidence_ambiguous",
  "edition_evidence_conflict",
  "edition_current_requires_classification",
]);
export const CutConclusionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("standard_unmarked") }),
  z.strictObject({ kind: z.literal("named"), cut: CutKindSchema }),
  z.strictObject({ kind: z.literal("ambiguous") }),
  z.strictObject({
    kind: z.literal("conflict"),
    cuts: z.array(CutKindSchema).min(2).max(6),
  }),
]);
const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const CutCanonicalSchema = z.strictObject({
  rootMediaId: z.string().min(1),
  title: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  episodeTitles: z
    .array(
      z.strictObject({
        title: z.string().min(1),
        seasonNumber: z.int().nonnegative(),
        episodeNumber: z.int().nonnegative(),
        absoluteNumber: z.int().positive().nullable(),
      }),
    )
    .optional(),
  digest: Hash,
});
export const CutSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("provider"),
    providerId: z.string(),
    providerReleaseId: z.string(),
  }),
  z.strictObject({
    kind: z.literal("member"),
    attemptId: z.string(),
    torrentFileIndex: z.int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("legacy_member"),
    attemptId: z.string(),
    operationId: z.string(),
  }),
  z.strictObject({
    kind: z.literal("legacy_asset"),
    assetId: z.string(),
    assetVersion: z.int().nonnegative(),
  }),
]);
export const EditionTextSchema = z.strictObject({
  text: z.string(),
  provenance: z.strictObject({
    kind: z.enum(["release-title", "provider-field"]),
    field: z.string().min(1),
  }),
});
export const CutMemberSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("torrent_member"),
    attemptId: z.string(),
    torrentFileIndex: z.int().nonnegative(),
    relativePath: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("legacy_plan_member"),
    attemptId: z.string(),
    operationId: z.string(),
    relativePath: z.string().min(1),
  }),
]);
const Span = z.strictObject({
  start: z.int().nonnegative(),
  end: z.int().positive(),
});
export const CutEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  parserVersion: z.literal("cut-markers-v1"),
  source: CutSourceSchema,
  sourceDigest: Hash,
  canonicalDigest: Hash,
  attribution: z.enum(["provider_texts", "legacy_primary", "torrent_member"]),
  texts: z
    .array(
      EditionTextSchema.safeExtend({
        canonicalSpans: z.array(Span),
        markers: z.array(
          Span.safeExtend({ token: z.string(), cut: CutKindSchema.nullable() }),
        ),
      }),
    )
    .max(20),
  issues: z.array(
    z.enum(["input_limit_exceeded", "unsupported_cut_qualifier"]),
  ),
  conclusion: CutConclusionSchema,
});
/** Safe public projection: no provider URL, source filename, or household identity. */
export const DefaultEditionDecisionSchema = z.strictObject({
  policy: z.literal("standard_unmarked"),
  accepted: z.boolean(),
  reasons: z.array(CutReasonSchema),
  candidate: CutConclusionSchema,
  current: z.array(CutConclusionSchema),
  members: z.array(CutConclusionSchema),
});
export type CutKind = z.infer<typeof CutKindSchema>;
export type CutMember = z.infer<typeof CutMemberSchema>;
export type CutReason = z.infer<typeof CutReasonSchema>;
export type CutCanonical = z.infer<typeof CutCanonicalSchema>;
export type CutSource = z.infer<typeof CutSourceSchema>;
export type EditionText = z.infer<typeof EditionTextSchema>;
export type CutEvidence = z.infer<typeof CutEvidenceSchema>;
export type CutConclusion = z.infer<typeof CutConclusionSchema>;
export type DefaultEditionDecision = z.infer<
  typeof DefaultEditionDecisionSchema
>;
