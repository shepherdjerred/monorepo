import { z } from "zod";
import {
  PublicationEntryIntentSchema,
  PublicationIntentSchema,
} from "#shared/publication-proof/intent.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import {
  PublicationEffectRefSchema,
  PublicationHashSchema,
  PublicationJournalSchema,
} from "#shared/publication-proof/effects.ts";
import { PublicationParticipantSchema } from "#shared/publication-proof/intent.ts";

export const SERIES_PACK_PUBLICATION_BATCH_SIZE_V1 = 4;
const BatchIndex = z.int().nonnegative().max(24);
const StagingSeal = z.strictObject({
  operationId: z.uuid(),
  sealHash: PublicationHashSchema,
});
export const SeriesPackPublicationInputV1Schema = z.strictObject({
  operationId: z.uuid(),
  attemptId: z.uuid(),
  batchIndex: BatchIndex,
});
export const SeriesPackPublicationSealInputV1Schema =
  SeriesPackPublicationInputV1Schema.omit({ batchIndex: true });
export const SeriesPackPublicationScopeV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  transitionId: z.uuid(),
  attemptId: z.uuid(),
  operationId: z.uuid(),
  attemptOperationId: z.uuid(),
  birthEpoch: z.int().nonnegative(),
  stagingSeal: StagingSeal,
  identityHash: PublicationHashSchema,
  observationHash: PublicationHashSchema,
  generationsHash: PublicationHashSchema,
  filePlanHash: PublicationHashSchema,
  mediaIds: z.array(z.uuid()).min(1).max(100),
  entryOperationIds: z
    .array(z.string().regex(/^[\w-]{1,100}$/u))
    .min(1)
    .max(100),
});
export const SeriesPackPublicationPreparedV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: SeriesPackPublicationScopeV1Schema,
  scopeHash: PublicationHashSchema,
  batchIndex: BatchIndex,
  entries: z
    .array(PublicationEntryIntentSchema)
    .min(1)
    .max(SERIES_PACK_PUBLICATION_BATCH_SIZE_V1),
});
export const SeriesPackPublicationPreparationPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("prepare_series_pack_publication_v1"),
  prepared: SeriesPackPublicationPreparedV1Schema,
  preparedHash: PublicationHashSchema,
  raw: z.string().min(1).max(4_194_304),
  scopeRaw: z.string().min(1).max(262_144),
  filePlanRaw: z.string().min(1).max(4_194_304),
});
const PreparationRef = z.strictObject({
  operationId: z.uuid(),
  batchIndex: BatchIndex,
  preparedHash: PublicationHashSchema,
});
export const SeriesPackPublicationIntentV3Schema = z
  .strictObject({
    ...PublicationIntentSchema.shape,
    schemaVersion: z.literal(3),
    seriesPackPublication: z.strictObject({
      schemaVersion: z.literal(1),
      coordinatorOperationId: z.uuid(),
      stagingSeal: StagingSeal,
      preparations: z.array(PreparationRef).min(1).max(25),
    }),
  })
  .superRefine((intent, ctx) => {
    const ids = intent.entries.flatMap(({ entry }) => entry.mediaIds);
    if (
      new Set(ids).size !== ids.length ||
      new Set(intent.mediaIds).size !== intent.mediaIds.length ||
      ids.length !== intent.mediaIds.length ||
      ids.some((id) => !intent.mediaIds.includes(id)) ||
      new Set(intent.entries.map(({ entry }) => entry.operationId)).size !==
        intent.entries.length ||
      new Set(intent.entries.map(({ entry }) => entry.assetId)).size !==
        intent.entries.length ||
      intent.seriesPackPublication.preparations.length !==
        Math.ceil(
          intent.entries.length / SERIES_PACK_PUBLICATION_BATCH_SIZE_V1,
        ) ||
      intent.seriesPackPublication.preparations.some(
        (ref, index) => ref.batchIndex !== index,
      ) ||
      new Set(
        intent.seriesPackPublication.preparations.map((ref) => ref.operationId),
      ).size !== intent.seriesPackPublication.preparations.length
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Series pack publication requires its exact complete disjoint plan and ordered preparation parents",
      });
  });
export const SeriesPackPublicationIntentRefV3Schema = z.strictObject({
  transitionId: z.uuid(),
  intentHash: PublicationHashSchema,
  intent: SeriesPackPublicationIntentV3Schema,
});
export const SeriesPackPublicationCommandV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("publish_series_pack_members_v1"),
  attemptId: z.uuid(),
  operationId: z.uuid(),
  transitionId: z.uuid(),
  intentHash: PublicationHashSchema,
  batchIndex: BatchIndex,
  entryOperationIds: z
    .array(z.string().regex(/^[\w-]{1,100}$/u))
    .min(1)
    .max(SERIES_PACK_PUBLICATION_BATCH_SIZE_V1),
});
export const SeriesPackPublicationPhysicalEntryV1Schema = z.strictObject({
  entryOperationId: z.string().regex(/^[\w-]{1,100}$/u),
  participants: z.array(PublicationParticipantSchema).min(1),
  journals: z.array(PublicationJournalSchema),
});
export const SeriesPackPublicationCompletionV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  commandHash: PublicationHashSchema,
  effects: z.array(PublicationEffectRefSchema),
  entries: z
    .array(SeriesPackPublicationPhysicalEntryV1Schema)
    .min(1)
    .max(SERIES_PACK_PUBLICATION_BATCH_SIZE_V1),
  completedAt: z.iso.datetime(),
});
export const SeriesPackPublicationPhysicalPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  command: SeriesPackPublicationCommandV1Schema,
  commandHash: PublicationHashSchema,
  raw: z.string().min(1).max(262_144),
});
export const SeriesPackPublicationPhysicalResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  completion: SeriesPackPublicationCompletionV1Schema,
  completionHash: PublicationHashSchema,
  raw: z.string().min(1).max(4_194_304),
});
export const SeriesPackPublicationInverseCommandV1Schema =
  SeriesPackPublicationCommandV1Schema.extend({
    kind: z.literal("compensate_series_pack_members_v1"),
  });
export const SeriesPackPublicationInversePayloadV1Schema =
  SeriesPackPublicationPhysicalPayloadV1Schema.extend({
    command: SeriesPackPublicationInverseCommandV1Schema,
  });
export const SeriesPackPublicationOutcomeV3Schema =
  PublicationOutcomeSchema.extend({
    schemaVersion: z.literal(3),
    seriesPackPublication: z.strictObject({
      schemaVersion: z.literal(1),
      sealOperationId: z.uuid(),
      publishReceipts: z
        .array(
          z.strictObject({
            operationId: z.uuid(),
            batchIndex: BatchIndex,
            completionHash: PublicationHashSchema,
          }),
        )
        .max(25),
      compensationReceipts: z
        .array(
          z.strictObject({
            operationId: z.uuid(),
            batchIndex: BatchIndex,
            completionHash: PublicationHashSchema,
          }),
        )
        .min(1)
        .max(25)
        .optional(),
    }),
  });
export type SeriesPackPublicationScopeV1 = z.infer<
  typeof SeriesPackPublicationScopeV1Schema
>;
export type SeriesPackPublicationPreparedV1 = z.infer<
  typeof SeriesPackPublicationPreparedV1Schema
>;
export type SeriesPackPublicationIntentV3 = z.infer<
  typeof SeriesPackPublicationIntentV3Schema
>;
export type SeriesPackPublicationIntentRefV3 = z.infer<
  typeof SeriesPackPublicationIntentRefV3Schema
>;
export type SeriesPackPublicationOutcomeV3 = z.infer<
  typeof SeriesPackPublicationOutcomeV3Schema
>;
export type SeriesPackPublicationInputV1 = z.infer<
  typeof SeriesPackPublicationInputV1Schema
>;
export type SeriesPackPublicationBatchResultV1<
  Status extends "prepared" | "published" | "compensated" =
    "prepared" | "published",
> =
  | { status: Status; receiptId: string; nextBatchIndex: number | null }
  | { status: "blocked" | "obsolete"; reason: string };
export type SeriesPackPublicationSealResultV1<
  Status extends "prepared" | "published" | "compensated" =
    "prepared" | "published",
> = { status: Status } | { status: "blocked" | "obsolete"; reason: string };
