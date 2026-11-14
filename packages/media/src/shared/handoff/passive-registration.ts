import { z } from "zod";
import { EvidenceHashSchema } from "#shared/migration.ts";

/** Explicit, hash-bound consent to promote one genuine passive registration. */
export const PassiveRegistrationApprovalSchema = z.strictObject({
  provenanceKey: EvidenceHashSchema,
  assetId: z.uuid(),
  expectedVersion: z.literal(0),
  registrationEventId: z.uuid(),
  registrationHash: EvidenceHashSchema,
  registrationRaw: z.string().min(2).max(256_000),
});

export type PassiveRegistrationApproval = z.infer<
  typeof PassiveRegistrationApprovalSchema
>;
export const PassiveRegistrationPreviewInputSchema = z.strictObject({
  bundleReviewId: z.uuid(),
  bundleReviewVersion: z.int().nonnegative(),
  selected: z
    .array(EvidenceHashSchema)
    .min(1)
    .max(25)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const PassiveRegistrationPreviewSchema = z
  .array(PassiveRegistrationApprovalSchema)
  .max(25);
