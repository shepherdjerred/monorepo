import { z } from "zod";
import { EvidenceHashSchema } from "#shared/migration.ts";

const ImportedRequestHistoryItemSchema = z.strictObject({
  id: EvidenceHashSchema,
  sourceKind: z.enum(["seerr", "overseerr", "jellyseerr"]),
  scope: z.enum(["movie", "series", "season", "episode"]),
  seasonNumbers: z.array(z.int().nonnegative()).max(1000),
  title: z.string().nullable(),
  requestedAt: z.iso.datetime({ precision: 3 }).nullable(),
  sourceStatus: z.int().min(1).max(5).nullable(),
});

export const ImportedRequestHistorySchema = z
  .array(ImportedRequestHistoryItemSchema)
  .max(1000);
