import { z } from "zod";
import { ActorSchema } from "./actor.ts";
import {
  IdentifierSchema,
  SlugSchema,
  StateTypeSchema,
  TeamKeySchema,
} from "./schema.ts";

export const ForumKindSchema = z.enum([
  "notice",
  "discussion",
  "question",
  "decision",
]);
export const ForumEmojiSchema = z.enum([
  "👍",
  "👎",
  "🎉",
  "❤️",
  "🚀",
  "👀",
  "🤔",
  "✅",
]);
export const ForumIdentifierSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^FM-[1-9]\d*$/u);
export const ForumPostIdOrIdentifierSchema = z.union([
  z.uuid(),
  ForumIdentifierSchema,
]);
export const ForumSortSchema = z.enum([
  "activity",
  "newest",
  "votes",
  "replies",
]);

const scopes = z.array(z.string().trim().min(1).max(200)).max(30);
const content = z.string().trim().min(1).max(1_000_000);
const condition = z.string().trim().min(1).max(100_000).nullable();
const expiry = z.iso.datetime({ offset: true }).nullable();
const attachments = z.array(z.uuid()).max(100);

export const ForumListSchema = z.object({
  kind: ForumKindSchema.optional(),
  scopes: scopes.default([]),
  state: z
    .enum([
      "active",
      "open",
      "resolved",
      "expired",
      "answered",
      "unanswered",
      "pinned",
      "all",
    ])
    .default("active"),
  projectSlug: SlugSchema.nullable().optional(),
  creatorKey: z.string().optional(),
  ownerKey: z.string().nullable().optional(),
  linkedIssueIdentifier: IdentifierSchema.optional(),
  unreadOnly: z.boolean().default(false),
  subscribedOnly: z.boolean().default(false),
  viewerActorKey: z.string().optional(),
  sort: ForumSortSchema.optional(),
  query: z.string().trim().max(500).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const ForumReferenceSchema = z.object({
  id: ForumPostIdOrIdentifierSchema,
  viewerActorKey: z.string().optional(),
});

export const CreateForumPostSchema = z
  .object({
    actor: ActorSchema,
    kind: ForumKindSchema,
    title: z.string().trim().min(1).max(500),
    body: content,
    scopes: scopes.default([]),
    exitCondition: condition.optional(),
    expiresAt: expiry.optional(),
    ownerKey: ActorSchema.shape.key.nullable().optional(),
    projectSlug: SlugSchema.nullable().optional(),
    attachmentIds: attachments.default([]),
    linkedIssueIdentifiers: z.array(IdentifierSchema).max(50).default([]),
    pinned: z.boolean().optional(),
  })
  .superRefine((post, ctx) => {
    if (post.kind === "notice" && post.exitCondition == null)
      ctx.addIssue({
        code: "custom",
        path: ["exitCondition"],
        message: "Notices require an exit condition",
      });
    if (
      post.kind !== "notice" &&
      (post.exitCondition != null ||
        post.expiresAt != null ||
        post.ownerKey != null)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Only notices have exit conditions, expiration, and coordination owners",
      });
  });

export const UpdateForumPostSchema = z.object({
  id: ForumPostIdOrIdentifierSchema,
  actor: ActorSchema,
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(500).optional(),
  body: content.optional(),
  scopes: scopes.optional(),
  exitCondition: condition.optional(),
  expiresAt: expiry.optional(),
  ownerKey: ActorSchema.shape.key.nullable().optional(),
  projectSlug: SlugSchema.nullable().optional(),
  attachmentIds: attachments.default([]),
});

export const ReplyForumSchema = z.object({
  id: ForumPostIdOrIdentifierSchema,
  actor: ActorSchema,
  body: content,
  parentReplyId: z.uuid().nullable().optional(),
  attachmentIds: attachments.default([]),
});

export const ReopenForumSchema = z.object({
  id: ForumPostIdOrIdentifierSchema,
  actor: ActorSchema,
  expectedRevision: z.number().int().positive(),
});

export const ResolveForumSchema = ReopenForumSchema.extend({ note: content });

export const UpdateForumReplySchema = z.object({
  actor: ActorSchema,
  replyId: z.uuid(),
  body: content,
  attachmentIds: attachments.default([]),
});

export const DeleteForumReplySchema = z.object({
  actor: ActorSchema,
  replyId: z.uuid(),
});

export const PinForumSchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  pinned: z.boolean(),
});

export const AcceptForumReplySchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  replyId: z.uuid().nullable(),
});

export const ClaimForumNoticeSchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  note: z.string().trim().min(1).max(100_000).optional(),
});

export const HandoffForumNoticeSchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  toActorKey: ActorSchema.shape.key.nullable(),
  note: z.string().trim().min(1).max(100_000).optional(),
});

const targetXor = (value: {
  id?: string | undefined;
  replyId?: string | undefined;
}) => (value.id !== undefined) !== (value.replyId !== undefined);
const targetXorMessage = "Specify exactly one of id or replyId";

export const VoteForumSchema = z
  .object({
    actor: ActorSchema,
    id: ForumPostIdOrIdentifierSchema.optional(),
    replyId: z.uuid().optional(),
    note: z.string().max(10_000).optional(),
    remove: z.boolean().default(false),
  })
  .refine(targetXor, targetXorMessage);

export const ReactForumSchema = z
  .object({
    actor: ActorSchema,
    id: ForumPostIdOrIdentifierSchema.optional(),
    replyId: z.uuid().optional(),
    emoji: ForumEmojiSchema,
    remove: z.boolean().default(false),
  })
  .refine(targetXor, targetXorMessage);

export const SubscribeForumSchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  mode: z.enum(["subscribed", "muted"]).nullable(),
});

export const MarkForumReadSchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  readAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export const ForumIssueLinkSchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  issueIdentifier: IdentifierSchema,
  sourceReplyId: z.uuid().optional(),
});

export const PromoteForumToIssueSchema = z.object({
  actor: ActorSchema,
  id: ForumPostIdOrIdentifierSchema,
  replyId: z.uuid().optional(),
  teamKey: TeamKeySchema.default("AI"),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(1_000_000).optional(),
  priority: z.number().int().min(0).max(4).default(0),
  stateName: z.string().min(1).max(200).optional(),
  stateType: StateTypeSchema.optional(),
  projectSlug: SlugSchema.nullable().optional(),
  assigneeKey: ActorSchema.shape.key.nullable().optional(),
  labels: z.array(z.string().min(1).max(200)).max(100).default([]),
});

export const ForumInboxSchema = z.object({
  viewerActorKey: z.string().min(1),
  unreadOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ForumKind = z.infer<typeof ForumKindSchema>;
export type ForumEmoji = z.infer<typeof ForumEmojiSchema>;
export type ForumSort = z.infer<typeof ForumSortSchema>;
export type ForumListInput = z.infer<typeof ForumListSchema>;
export type CreateForumPostInput = z.infer<typeof CreateForumPostSchema>;
export type UpdateForumPostInput = z.infer<typeof UpdateForumPostSchema>;
export type ReplyForumInput = z.infer<typeof ReplyForumSchema>;
export type UpdateForumReplyInput = z.infer<typeof UpdateForumReplySchema>;
export type DeleteForumReplyInput = z.infer<typeof DeleteForumReplySchema>;
export type ResolveForumInput = z.infer<typeof ResolveForumSchema>;
export type ReopenForumInput = z.infer<typeof ReopenForumSchema>;
export type PinForumInput = z.infer<typeof PinForumSchema>;
export type AcceptForumReplyInput = z.infer<typeof AcceptForumReplySchema>;
export type ClaimForumNoticeInput = z.infer<typeof ClaimForumNoticeSchema>;
export type HandoffForumNoticeInput = z.infer<typeof HandoffForumNoticeSchema>;
export type VoteForumInput = z.infer<typeof VoteForumSchema>;
export type ReactForumInput = z.infer<typeof ReactForumSchema>;
export type SubscribeForumInput = z.infer<typeof SubscribeForumSchema>;
export type MarkForumReadInput = z.infer<typeof MarkForumReadSchema>;
export type ForumIssueLinkInput = z.infer<typeof ForumIssueLinkSchema>;
export type PromoteForumToIssueInput = z.infer<
  typeof PromoteForumToIssueSchema
>;
export type ForumInboxInput = z.infer<typeof ForumInboxSchema>;
