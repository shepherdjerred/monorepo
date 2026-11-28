import { z } from "zod";

export const ManagedCategorySchema = z.enum([
  "Engineering & Infra",
  "AI",
  "Essays & Personal Blogs",
]);
export type ManagedCategory = z.infer<typeof ManagedCategorySchema>;

export const FeedSourceSchema = z.enum(["code", "user"]);
export type FeedSource = z.infer<typeof FeedSourceSchema>;

export const EntryViewSchema = z.enum([
  "unread",
  "all",
  "starred",
  "auto-read",
]);
export type EntryView = z.infer<typeof EntryViewSchema>;

export const AutoReadFieldSchema = z.enum(["title", "url", "category"]);
export type AutoReadField = z.infer<typeof AutoReadFieldSchema>;

export const SingleAutoReadRuleSchema = z.strictObject({
  field: AutoReadFieldSchema,
  pattern: z.string().min(1),
  flags: z.enum(["", "i"]),
  negate: z.boolean().optional(),
});
export type SingleAutoReadRule = z.infer<typeof SingleAutoReadRuleSchema>;

export const AutoReadRuleSchema = z.union([
  SingleAutoReadRuleSchema,
  z.array(SingleAutoReadRuleSchema).min(1).max(20).readonly(),
]);
export type AutoReadRule = z.infer<typeof AutoReadRuleSchema>;

export function normalizeAutoReadRules(
  rule: AutoReadRule,
): readonly SingleAutoReadRule[] {
  return "field" in rule ? [rule] : rule;
}

export type DeclaredFeed = {
  readonly category: ManagedCategory;
  readonly title: string;
  readonly url: string;
  readonly htmlUrl?: string | undefined;
  readonly description?: string | undefined;
  readonly hidden?: boolean | undefined;
  readonly autoRead?: AutoReadRule | undefined;
};

export const EnclosureSchema = z.strictObject({
  href: z.string().min(1),
  type: z.string().optional(),
  length: z.number().int().nonnegative().optional(),
});
export type Enclosure = z.infer<typeof EnclosureSchema>;

export const CategorySummarySchema = z.strictObject({
  id: z.number().int().positive(),
  label: z.string().min(1),
  managed: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
  feedCount: z.number().int().nonnegative(),
});
export type CategorySummary = z.infer<typeof CategorySummarySchema>;

export const SummaryResponseSchema = z.strictObject({
  views: z.strictObject({
    unread: z.number().int().nonnegative(),
    all: z.number().int().nonnegative(),
    starred: z.number().int().nonnegative(),
    autoRead: z.number().int().nonnegative(),
  }),
  categories: z.array(CategorySummarySchema),
  stats: z.strictObject({
    totalFeeds: z.number().int().nonnegative(),
    codeFeeds: z.number().int().nonnegative(),
    userFeeds: z.number().int().nonnegative(),
    failingFeeds: z.number().int().nonnegative(),
    lastPolledAt: z.number().int().nullable(),
  }),
});
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export const EntryListItemSchema = z.strictObject({
  id: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  publishedAt: z.number().int(),
  crawledAtMs: z.number().int(),
  isRead: z.boolean(),
  isStarred: z.boolean(),
  autoReadMatched: z.boolean(),
  feed: z.strictObject({
    id: z.number().int().positive(),
    title: z.string(),
    category: z.string(),
    htmlUrl: z.string().nullable(),
  }),
});
export type EntryListItem = z.infer<typeof EntryListItemSchema>;

export const EntriesResponseSchema = z.strictObject({
  items: z.array(EntryListItemSchema),
  totalMatching: z.number().int().nonnegative(),
  nextCursor: z.number().int().positive().nullable(),
});
export type EntriesResponse = z.infer<typeof EntriesResponseSchema>;

export const FeedHealthItemSchema = z.strictObject({
  id: z.number().int().positive(),
  title: z.string(),
  category: z.string(),
  source: FeedSourceSchema,
  hidden: z.boolean(),
  /** Redacted when source === 'user' and query/auth components are present. */
  displayUrl: z.string(),
  htmlUrl: z.string().nullable(),
  description: z.string().nullable(),
  autoRead: AutoReadRuleSchema.nullable(),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  lastPolledAt: z.number().int().nullable(),
  lastSuccessAt: z.number().int().nullable(),
  lastStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  nextPollAfter: z.number().int().nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type FeedHealthItem = z.infer<typeof FeedHealthItemSchema>;

export const FeedsListResponseSchema = z.strictObject({
  feeds: z.array(FeedHealthItemSchema),
  categories: z.array(CategorySummarySchema),
});
export type FeedsListResponse = z.infer<typeof FeedsListResponseSchema>;

export const UpdateEntriesStateBodySchema = z.strictObject({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
});
export type UpdateEntriesStateBody = z.infer<
  typeof UpdateEntriesStateBodySchema
>;

export const MarkAllReadBodySchema = z.strictObject({
  view: EntryViewSchema.optional(),
  category: z.string().min(1).optional(),
  feedId: z.number().int().positive().optional(),
  q: z.string().optional(),
  beforeId: z.number().int().positive().optional(),
  publishedBefore: z.number().int().positive().optional(),
  includeHidden: z.boolean().optional(),
  excludeStarred: z.boolean().optional(),
});
export type MarkAllReadBody = z.infer<typeof MarkAllReadBodySchema>;

export const CreateUserFeedBodySchema = z.strictObject({
  url: z.url(),
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(100).default("Uncategorized"),
  htmlUrl: z.url().optional(),
  hidden: z.boolean().default(false),
  autoRead: AutoReadRuleSchema.nullable().optional(),
});
export type CreateUserFeedBody = z.infer<typeof CreateUserFeedBodySchema>;

export const UpdateUserFeedBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  /** Optional write-only replacement URL so secret query tokens never need to round-trip to the browser. */
  url: z.url().optional(),
  htmlUrl: z.url().nullable().optional(),
  hidden: z.boolean().optional(),
  autoRead: AutoReadRuleSchema.nullable().optional(),
});
export type UpdateUserFeedBody = z.infer<typeof UpdateUserFeedBodySchema>;

export const PollRunSummarySchema = z.strictObject({
  skippedByFlag: z.boolean(),
  polled: z.number().int().nonnegative(),
  notModified: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  backedOff: z.number().int().nonnegative(),
  newEntries: z.number().int().nonnegative(),
  autoReadEntries: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type PollRunSummary = z.infer<typeof PollRunSummarySchema>;
