import { z } from "zod";
import { SubtitleUpgradeV1Schema } from "./score.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";

export const SubtitleMaintenanceModeV1Schema = z.enum(["wanted", "upgrade"]);
export const SubtitleMaintenanceJobV1Schema = z.strictObject({
  operationId: z.uuid(),
  assetId: z.uuid(),
  language: z.string(),
  forced: z.boolean().optional(),
  hearingImpaired: z.enum(["required", "excluded", "any"]).optional(),
  recoveryEpoch: z.int().nonnegative(),
  targetAuthority: z.string().regex(/^[a-f0-9]{64}$/u),
  movieScope: MovieEditionScopeSchema.optional(),
  upgradeV1: SubtitleUpgradeV1Schema.optional(),
});
export type SubtitleMaintenanceJobV1 = z.infer<
  typeof SubtitleMaintenanceJobV1Schema
>;
export type SubtitleMaintenanceModeV1 = z.infer<
  typeof SubtitleMaintenanceModeV1Schema
>;
export type SubtitleMaintenanceActivitiesV1 = {
  listSubtitleMaintenanceV1: (input: {
    cursor: string | null;
  }) => Promise<{ assetIds: string[]; nextCursor: string | null }>;
  prepareSubtitleMaintenanceV1: (input: {
    assetId: string;
    mode: SubtitleMaintenanceModeV1;
  }) => Promise<SubtitleMaintenanceJobV1[]>;
  beginAutomaticSubtitleReplacementV1: (input: {
    job: SubtitleMaintenanceJobV1;
    candidateSubtitleId: string;
  }) => Promise<{
    replacementId: string;
    preparationOperationId: string;
  } | null>;
  approveAutomaticSubtitleReplacementV1: (input: {
    job: SubtitleMaintenanceJobV1;
    candidateSubtitleId: string;
    replacementId: string;
  }) => Promise<"waiting" | "queued" | "protected">;
};
