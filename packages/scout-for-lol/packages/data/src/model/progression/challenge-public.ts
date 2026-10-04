import { z } from "zod";
import { ChallengeContractV1Schema } from "#src/model/progression/challenge.ts";

export const ChallengeTemplateVersionSchema = z.strictObject({
  id: z.uuid(),
  templateId: z.uuid(),
  version: z.number().int().positive(),
  authorDiscordId: z.string().min(1),
  contract: ChallengeContractV1Schema,
  publishedAt: z.iso.datetime(),
});
export type ChallengeTemplateVersion = z.infer<
  typeof ChallengeTemplateVersionSchema
>;

export const ChallengeRunStatusSchema = z.enum([
  "active",
  "completed",
  "archived",
  "failed",
]);
export type ChallengeRunStatus = z.infer<typeof ChallengeRunStatusSchema>;
