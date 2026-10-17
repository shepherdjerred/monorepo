import { z } from "zod";
import { EvidenceHashSchema } from "./migration.ts";
export const DiscoverMigrationCatalogSchema = z.strictObject({
  captureHash: EvidenceHashSchema,
  cursor: z.number().int().nonnegative().max(50_000).default(0),
});
export const MigrationDiscoveryResultSchema = z.strictObject({
  captureHash: EvidenceHashSchema,
  nextCursor: z.number().int().nonnegative().nullable(),
  entries: z
    .array(
      z.strictObject({
        sourceId: z.string(),
        mediaId: z.uuid().nullable(),
        status: z.enum(["ready", "catalog_pending", "protected"]),
        reason: z.string().nullable(),
      }),
    )
    .max(10),
  ownershipTransferred: z.literal(false),
});
