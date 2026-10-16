import { z } from "zod";
import contract from "#contracts/content-moderation.json";

export const moderationContract = z
  .strictObject({
    version: z.literal(1),
    maxTextChars: z.number().int().positive(),
    maxContextChars: z.number().int().positive(),
    categories: z.array(z.string()).min(1),
    decisions: z.array(z.string()).min(1),
    requestFields: z.array(z.string()),
    responseFields: z.array(z.string()),
  })
  .parse(contract);

export const ModerationRequestSchema = z.strictObject({
  version: z.literal(1),
  submissionId: z.uuid(),
  authorId: z.string().min(1).max(128),
  authorName: z.string().min(1).max(128),
  surface: z.string().min(1).max(64),
  audience: z.string().min(1).max(256),
  text: z
    .string()
    .min(1)
    .refine((text) => {
      let codePoints = 0;
      for (const _codePoint of text) codePoints += 1;
      return codePoints <= moderationContract.maxTextChars;
    }, "Text exceeds Unicode code-point limit"),
  context: z.string().max(moderationContract.maxContextChars),
});
export const ContentVerdictSchema = z.strictObject({
  decision: z.enum(["allow", "block", "review"]),
  category: z.enum([
    "none",
    "hate",
    "harassment",
    "threat",
    "advertising",
    "spam",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(2000),
});
export const ModerationResponseSchema = ContentVerdictSchema.extend({
  version: z.literal(1),
  model: z.string().min(1).max(200),
  costMicros: z.number().int().nonnegative(),
  scores: z.record(z.string(), z.number().min(0).max(1)),
});
if (
  Object.keys(ModerationRequestSchema.shape).join(",") !==
    moderationContract.requestFields.join(",") ||
  Object.keys(ModerationResponseSchema.shape).sort().join(",") !==
    [...moderationContract.responseFields].sort().join(",") ||
  ContentVerdictSchema.shape.category.options.join(",") !==
    moderationContract.categories.join(",") ||
  ContentVerdictSchema.shape.decision.options.join(",") !==
    moderationContract.decisions.join(",")
)
  throw new Error("content moderation differs from the shared contract");

export type ModerationRequest = z.infer<typeof ModerationRequestSchema>;
export type ContentVerdict = z.infer<typeof ContentVerdictSchema>;
export type ModerationResponse = z.infer<typeof ModerationResponseSchema>;
