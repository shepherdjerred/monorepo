import { z } from "zod";
import { ActorSchema } from "./actor.ts";

export const ForumKindSchema = z.enum(["notice", "discussion"]);
const scopes = z.array(z.string().trim().min(1).max(200)).max(30);
const content = z.string().trim().min(1).max(1_000_000);
const condition = z.string().trim().min(1).max(100_000).nullable();
const expiry = z.iso.datetime({ offset: true }).nullable();
export const ForumListSchema = z.object({
  kind: ForumKindSchema.optional(),
  scopes: scopes.default([]),
  state: z.enum(["active", "resolved", "expired", "all"]).default("active"),
  query: z.string().trim().max(500).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export const ForumReferenceSchema = z.object({ id: z.uuid() });
export const CreateForumPostSchema = z
  .object({
    actor: ActorSchema,
    kind: ForumKindSchema,
    title: z.string().trim().min(1).max(500),
    body: content,
    scopes: scopes.default([]),
    exitCondition: condition.optional(),
    expiresAt: expiry.optional(),
  })
  .superRefine((post, ctx) => {
    if (post.kind === "notice" && post.exitCondition == null)
      ctx.addIssue({
        code: "custom",
        path: ["exitCondition"],
        message: "Notices require an exit condition",
      });
    if (
      post.kind === "discussion" &&
      (post.exitCondition != null || post.expiresAt != null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Only notices have exit conditions and expiration",
      });
  });
export const UpdateForumPostSchema = ForumReferenceSchema.extend({
  actor: ActorSchema,
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(500).optional(),
  body: content.optional(),
  scopes: scopes.optional(),
  exitCondition: condition.optional(),
  expiresAt: expiry.optional(),
});
export const ReplyForumSchema = ForumReferenceSchema.extend({
  actor: ActorSchema,
  body: content,
});
export const ReopenForumSchema = ForumReferenceSchema.extend({
  actor: ActorSchema,
  expectedRevision: z.number().int().positive(),
});
export const ResolveForumSchema = ReopenForumSchema.extend({ note: content });
export type ForumListInput = z.infer<typeof ForumListSchema>;
export type CreateForumPostInput = z.infer<typeof CreateForumPostSchema>;
export type UpdateForumPostInput = z.infer<typeof UpdateForumPostSchema>;
