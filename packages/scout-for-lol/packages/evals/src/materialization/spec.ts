import { z } from "zod";

import { BETA_CORPUS_BUCKET } from "#materialization/beta-corpus.ts";
import {
  CreateDatasetInputSchema,
  DatasetIdSchema,
  PerformanceSliceSchema,
} from "#shared/schema.ts";

export const EvalStyleKeySchema = z.enum(["aaron", "nekoryan"]);

export const MaterializationCaseSpecSchema = z.strictObject({
  matchKey: z.string().regex(/^games\/\d{4}\/\d{2}\/\d{2}\/.+\/match\.json$/),
  timelineKey: z
    .string()
    .regex(/^games\/\d{4}\/\d{2}\/\d{2}\/.+\/timeline\.json$/),
  targetPlayerId: z.number().int().positive(),
  targetPlayerPuuid: z.string().min(1),
  performanceSlice: PerformanceSliceSchema,
  styleKey: EvalStyleKeySchema,
  selectedBehaviors: z.array(z.string().trim().min(1)).min(1),
  playerHistory: z.string().default(""),
  patchContext: z.string().default(""),
});

const MaterializationSpecFields = {
  bucket: z.literal(BETA_CORPUS_BUCKET).default(BETA_CORPUS_BUCKET),
  cases: z.array(MaterializationCaseSpecSchema).min(1),
};

export const MaterializationDatasetTargetSchema = z.union([
  z.strictObject({ dataset: CreateDatasetInputSchema }),
  z.strictObject({ datasetId: DatasetIdSchema }),
]);

export const MaterializationSpecSchema = z.union([
  z.strictObject({
    ...MaterializationSpecFields,
    dataset: CreateDatasetInputSchema,
  }),
  z.strictObject({
    ...MaterializationSpecFields,
    datasetId: DatasetIdSchema,
  }),
]);

export type MaterializationCaseSpec = z.infer<
  typeof MaterializationCaseSpecSchema
>;
export type MaterializationDatasetTarget = z.input<
  typeof MaterializationDatasetTargetSchema
>;
export type MaterializationSpec = z.infer<typeof MaterializationSpecSchema>;

export function materializationDatasetTarget(
  spec: MaterializationSpec,
): MaterializationDatasetTarget {
  return "datasetId" in spec
    ? { datasetId: spec.datasetId }
    : { dataset: spec.dataset };
}

export async function readMaterializationSpec(
  path: string,
): Promise<MaterializationSpec> {
  const contents = await Bun.file(path).text();
  const parsed: unknown = JSON.parse(contents);
  return MaterializationSpecSchema.parse(parsed);
}
