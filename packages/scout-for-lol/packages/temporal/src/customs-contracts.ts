import { z } from "zod";
import { ScoutStageSchema } from "./contracts.ts";

export const ScoutCustomOperationActionSchema = z.enum([
  "arrange",
  "return",
  "continue",
  "void",
  "end",
  "expire",
]);
export type ScoutCustomOperationAction = z.infer<
  typeof ScoutCustomOperationActionSchema
>;
export const ScoutCustomOperationInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  operationId: z.string().min(1),
});
export type ScoutCustomOperationInput = z.infer<
  typeof ScoutCustomOperationInputSchema
>;
export const ScoutCustomPublicationInputSchema = z.strictObject({
  stage: ScoutStageSchema,
  nightId: z.uuid(),
  revision: z.int().nonnegative(),
});
export type ScoutCustomPublicationInput = z.infer<
  typeof ScoutCustomPublicationInputSchema
>;
export const ScoutCustomOperationResultSchema = z.strictObject({
  nightId: z.uuid(),
  state: z.enum(["completed", "held"]),
});
export type ScoutCustomOperationResult = z.infer<
  typeof ScoutCustomOperationResultSchema
>;

export type ScoutCustomActivities = {
  executeCustomOperation: (
    input: ScoutCustomOperationInput,
  ) => Promise<ScoutCustomOperationResult>;
  publishCustomNight: (input: ScoutCustomPublicationInput) => Promise<void>;
};

export function scoutCustomOperationWorkflowId(
  stage: z.infer<typeof ScoutStageSchema>,
  operationId: string,
): string {
  return `scout-${stage}-custom-operation:${operationId}`;
}
export function scoutCustomPublicationWorkflowId(
  stage: z.infer<typeof ScoutStageSchema>,
  nightId: string,
  revision: number,
): string {
  return `scout-${stage}-custom-publication:${nightId}:${revision.toString()}`;
}
