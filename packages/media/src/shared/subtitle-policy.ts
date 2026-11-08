import { z } from "zod";
import { SubtitleSourceProfileSchema } from "./migration-subtitles.ts";

export const SubtitlePolicyTargetSchema = z.strictObject({
  sourceItemId: z.int().positive(),
  language: z.enum(["en", "zh-Hans"]),
  audioLanguage: z.string().regex(/^[a-z]{2,3}$/u),
  forced: z.boolean(),
  hearingImpaired: z.enum(["required", "excluded", "any"]),
  audio: z.enum(["any", "exclude_matching", "only_matching"]),
});
export const SubtitlePolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  targets: z.array(SubtitlePolicyTargetSchema).max(20),
  protectedReasons: z.array(z.string().max(100)).max(30),
});
export const SubtitlePolicySatisfactionSchema = z.object({
  satisfied: z.boolean(),
  missing: z.array(SubtitlePolicyTargetSchema),
  protectedReasons: z.array(z.string()),
});
export const SubtitlePolicyResolutionSchema = z.strictObject({
  provenanceKey: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedPolicyVersion: z.int().min(-1),
  // An explicit language choice changes the desired policy, never the quality of existing files.
  chinese: z.enum(["unresolved", "require_simplified"]).default("unresolved"),
});
export const HandoffSubtitlePolicySchema = z.strictObject({
  provenanceKey: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaIds: z.array(z.uuid()).min(1).max(100),
  expectedPolicyVersion: z.int().min(-1),
  source: SubtitleSourceProfileSchema,
  resolution: z.enum(["unresolved", "require_simplified"]),
  rules: SubtitlePolicySchema,
});
