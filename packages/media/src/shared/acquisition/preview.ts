import { z } from "zod";
import { CanonicalIdentitySchema } from "./identity.ts";
import { ProviderReferenceSchema } from "./catalog.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const IdentityPreviewInputSchema = z.strictObject({
  mediaIds: z.array(z.uuid()).min(1).max(100),
});
export const IdentityConfirmationSchema = z.strictObject({
  previewDigest: Hash,
  candidateDigest: Hash,
  mediaIds: z.array(z.uuid()).min(1).max(100),
  numberingDigest: Hash.nullable(),
  reason: z.string().trim().min(10).max(2000),
  acknowledgeIdentity: z.literal(true),
});
export const IdentityPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.uuid(),
  candidateDigest: Hash,
  previewDigest: Hash,
  providerId: z.string(),
  title: z.string(),
  identityReasons: z.array(z.string()),
  references: z.array(ProviderReferenceSchema),
  canonical: CanonicalIdentitySchema,
  canonicalTitle: z.string(),
  canonicalYear: z.number().nullable(),
  media: z
    .array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        year: z.number().nullable(),
        version: z.number().int().nonnegative(),
        generation: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(100),
  sponsorRequestId: z.uuid().nullable(),
  numberingDigest: Hash.nullable(),
  qualityBlockers: z.array(z.string()),
  confirmationAllowed: z.boolean(),
});
export type IdentityPreviewInput = z.infer<typeof IdentityPreviewInputSchema>;
export type IdentityConfirmation = z.infer<typeof IdentityConfirmationSchema>;
export type IdentityPreview = z.infer<typeof IdentityPreviewSchema>;
