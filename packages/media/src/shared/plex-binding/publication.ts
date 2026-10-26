import { z } from "zod";
import { PublicationHashSchema as Hash } from "#shared/publication-proof/effects.ts";
import { PlexBindingExpectedSchema } from "./expected.ts";
import { PlexBindingVerificationCompletionSchema } from "./observations.ts";

export const AcquisitionPlexPublicationInputSchema = z.strictObject({
  operationId: z.uuid(),
  attemptId: z.uuid(),
});

/** NEW20 completion only. Mutable command result siblings are deliberately excluded. */
export const AcquisitionPlexPublicationReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  input: AcquisitionPlexPublicationInputSchema,
  command: z.strictObject({
    kind: z.enum(["reconcile_media", "acquire_release"]),
    targetId: z.uuid(),
    userId: z.uuid().nullable(),
    payloadHash: Hash,
  }),
  attempt: z.strictObject({
    operationId: z.uuid(),
    coordinatorOperationId: z.uuid(),
    releaseId: z.uuid(),
    sponsorRequestId: z.uuid(),
    torrentId: z.uuid(),
    edition: z.literal("default"),
    recoveryEpoch: z.int().nonnegative(),
    mediaIds: z.array(z.uuid()).min(1).max(10_000),
    generationsHash: Hash,
    filePlanHash: Hash,
    identityHash: Hash.nullable(),
    movieBirthHash: Hash,
  }),
  expected: PlexBindingExpectedSchema,
  completion: PlexBindingVerificationCompletionSchema,
});

export const AcquisitionPlexPublicationEnvelopeSchema = z.strictObject({
  receiptHash: Hash,
  receipt: z.json(),
});
export type AcquisitionPlexPublicationReceipt = z.infer<
  typeof AcquisitionPlexPublicationReceiptSchema
>;
export type AcquisitionPlexPublicationInput = z.infer<
  typeof AcquisitionPlexPublicationInputSchema
>;
