import { z } from "zod";

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const TargetId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(100);
const Etag = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w".-]+$/);
const OfficialUrl = z
  .url()
  .max(1000)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "Expected an official HTTPS URL without credentials, query or fragment");

export const PROMOTION_ABSENCE_ATTESTATION =
  "I independently reviewed this exact entity ID/name/slug and official update semantics: its monotonic last-bump watermark establishes no bump for this original occurrence.";

/** Operator-reviewed public facts, never model prose, credentials or page bodies. */
export const PromotionAbsenceEvidenceSchema = z.strictObject({
  version: z.literal(1),
  namespace: z.literal("prod"),
  targetId: TargetId,
  action: z.literal("bump"),
  originalOccurrenceId: z.string().max(250),
  attemptedAt: z.iso.datetime(),
  contentHash: Sha256,
  entity: z.strictObject({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[\w-]+$/),
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\p{L}\p{N} ._'’-]+$/u),
    slug: TargetId,
    url: OfficialUrl,
  }),
  observation: z.strictObject({
    pageUrl: OfficialUrl,
    observedAt: z.iso.datetime(),
    basis: z.literal("last-bump-watermark"),
    field: z.literal("last_bumped_at"),
    lastActionAt: z.iso.datetime(),
    artifacts: z
      .array(
        z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("official-source"),
            url: OfficialUrl,
            sha256: Sha256,
          }),
          z.strictObject({
            kind: z.enum(["screenshot", "scoped-observation"]),
            sha256: Sha256,
          }),
        ]),
      )
      .min(2)
      .max(10)
      .refine(
        (artifacts) =>
          artifacts.some((a) => a.kind === "official-source") &&
          artifacts.some((a) => a.kind === "scoped-observation") &&
          new Set(artifacts.map((a) => a.kind)).size === artifacts.length,
        "Require distinct official-source and scoped-observation artifacts",
      ),
  }),
  review: z.strictObject({
    reference: z.string().regex(/^AI-?\d+$/),
    attestation: z.literal(PROMOTION_ABSENCE_ATTESTATION),
  }),
});
export type PromotionAbsenceEvidence = z.infer<
  typeof PromotionAbsenceEvidenceSchema
>;

export const PromotionAbsenceResolutionSchema = z
  .strictObject({
    operation: z.literal("resolve-absence"),
    namespace: z.literal("prod"),
    targetId: TargetId,
    resolutionId: z.uuid(),
    expectedStateEtag: Etag.optional(),
    evidenceSha256: Sha256,
    evidenceJson: z.string().min(1).max(16_384),
    apply: z.boolean(),
  })
  .refine(
    (input) => !input.apply || input.expectedStateEtag !== undefined,
    "Apply requires the reviewed state ETag",
  );
export type PromotionAbsenceResolution = z.infer<
  typeof PromotionAbsenceResolutionSchema
>;

/** A state reference proves commitment; an immutable prepared audit alone does not. */
export const PromotionOperatorResolutionSchema = z.strictObject({
  resolutionId: z.uuid(),
  evidenceSha256: Sha256,
  auditSha256: Sha256,
  auditKey: z.string().min(1),
});
