import { z } from "zod";

export const ORDINARY_STAGING_BATCH_SIZE = 4;
export const OrdinaryStagingBatchSchema = z.union([
  z.strictObject({ schemaVersion: z.literal(1), batchIndex: z.null() }),
  z.strictObject({
    schemaVersion: z.literal(1),
    batchIndex: z.int().min(0).max(24),
    filePlanHash: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
]);
export type OrdinaryStagingBatch = z.infer<typeof OrdinaryStagingBatchSchema>;
