import { z } from "zod";
import { EvidenceHashSchema } from "#shared/migration.ts";

/** Original first ownership, independent of any acquisition or later serving observation. */
export const LibraryAssetReferenceV1Schema = z.strictObject({
  kind: z.literal("library_adoption_v1"),
  receiptId: z.uuid(),
  planId: z.uuid(),
  planHash: EvidenceHashSchema,
  assetId: z.uuid(),
  assetVersion: z.literal(0),
  bindingHash: EvidenceHashSchema,
  physicalEvidenceHash: EvidenceHashSchema,
});
export type LibraryAssetReferenceV1 = z.infer<
  typeof LibraryAssetReferenceV1Schema
>;
