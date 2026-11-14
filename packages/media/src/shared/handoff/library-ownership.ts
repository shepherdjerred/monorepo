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

/** A registered passive file gains its first physical owner at exactly version one. */
export const PassiveLibraryAssetReferenceV1Schema =
  LibraryAssetReferenceV1Schema.extend({
    assetVersion: z.literal(1),
  });
export const LibraryAssetReferenceProtocolSchema = z.union([
  LibraryAssetReferenceV1Schema,
  PassiveLibraryAssetReferenceV1Schema,
]);
