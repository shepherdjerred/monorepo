import { z } from "zod";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import {
  PublicationHashSchema,
  PublicationJournalSchema,
} from "#shared/publication-proof/effects.ts";

export const SERIES_PACK_STAGING_BATCH_SIZE_V1 = 4;

export const SeriesPackStagingInputV1Schema = z.strictObject({
  operationId: z.uuid(),
  attemptId: z.uuid(),
  batchIndex: z.int().nonnegative().max(24),
});
export const SeriesPackStagingSealInputV1Schema =
  SeriesPackStagingInputV1Schema.omit({ batchIndex: true });

export const SeriesPackStagingScopeV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  attemptId: z.uuid(),
  operationId: z.uuid(),
  attemptOperationId: z.uuid(),
  recoveryEpoch: z.int().nonnegative(),
  identityHash: PublicationHashSchema,
  identityRaw: z.string().min(1).max(262_144),
  observationHash: PublicationHashSchema,
  observationRaw: z.string().min(1).max(262_144),
  generationsHash: PublicationHashSchema,
  generationsRaw: z.string().min(1).max(32_768),
  coverage: z.array(z.uuid()).min(1).max(100),
  members: z
    .array(
      z.strictObject({
        torrentFileIndex: z.int().nonnegative(),
        relativePath: z.string().min(1).max(4096),
        sizeBytes: z.string().regex(/^\d+$/u),
        coverage: z.array(z.uuid()).min(1).max(100),
      }),
    )
    .min(1)
    .max(100),
});
export const SeriesPackStagingPreparedV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: SeriesPackStagingScopeV1Schema,
  scopeHash: PublicationHashSchema,
  batchIndex: SeriesPackStagingInputV1Schema.shape.batchIndex,
  entries: z
    .array(FilePlanEntrySchema)
    .min(1)
    .max(SERIES_PACK_STAGING_BATCH_SIZE_V1),
});
export const SeriesPackStagingPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("stage_series_pack_members_v1"),
  prepared: SeriesPackStagingPreparedV1Schema,
  preparedHash: PublicationHashSchema,
  scopeRaw: z.string().min(1).max(524_288),
  raw: z.string().min(1).max(1_048_576),
});
export const SeriesPackStagingCompletionV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  preparedHash: PublicationHashSchema,
  journals: z
    .array(PublicationJournalSchema)
    .min(1)
    .max(SERIES_PACK_STAGING_BATCH_SIZE_V1),
});
export const SeriesPackStagingResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  completion: SeriesPackStagingCompletionV1Schema,
  completionHash: PublicationHashSchema,
  raw: z.string().min(1).max(262_144),
});
export const SeriesPackStagingSealV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  attemptId: z.uuid(),
  operationId: z.uuid(),
  scope: SeriesPackStagingScopeV1Schema,
  scopeHash: PublicationHashSchema,
  filePlanHash: PublicationHashSchema,
  receipts: z
    .array(
      z.strictObject({
        operationId: z.uuid(),
        batchIndex: SeriesPackStagingInputV1Schema.shape.batchIndex,
        preparedHash: PublicationHashSchema,
        completionHash: PublicationHashSchema,
      }),
    )
    .min(1)
    .max(25),
});
export const SeriesPackStagingSealPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("seal_series_pack_staging_v1"),
  seal: SeriesPackStagingSealV1Schema,
  sealHash: PublicationHashSchema,
  scopeRaw: z.string().min(1).max(524_288),
  filePlanRaw: z.string().min(1).max(1_048_576),
  raw: z.string().min(1).max(1_048_576),
});

export type SeriesPackStagingInputV1 = z.infer<
  typeof SeriesPackStagingInputV1Schema
>;
export type SeriesPackStagingScopeV1 = z.infer<
  typeof SeriesPackStagingScopeV1Schema
>;
export type SeriesPackStagingPreparedV1 = z.infer<
  typeof SeriesPackStagingPreparedV1Schema
>;
export type SeriesPackStagingSealV1 = z.infer<
  typeof SeriesPackStagingSealV1Schema
>;
export type SeriesPackStagingBatchResultV1 =
  | { status: "staged"; receiptId: string; nextBatchIndex: number | null }
  | { status: "blocked" | "obsolete"; reason: string };
export type SeriesPackStagingSealResultV1 =
  { status: "staged" } | { status: "blocked" | "obsolete"; reason: string };
