import { z } from "zod";

export const BugsinkIssueSchema = z.object({
  id: z.string(),
  project: z.number(),
  digest_order: z.number(),
  last_seen: z.string(),
  first_seen: z.string(),
  digested_event_count: z.number(),
  stored_event_count: z.number(),
  calculated_type: z.string(),
  calculated_value: z.string(),
  transaction: z.string(),
  is_resolved: z.boolean(),
  is_resolved_by_next_release: z.boolean(),
  is_muted: z.boolean(),
});

export const BugsinkTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  visibility: z.string(),
});

export const BugsinkProjectDetailSchema = z.object({
  id: z.number(),
  team: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  dsn: z.string(),
  digested_event_count: z.number(),
  stored_event_count: z.number(),
  visibility: z.string(),
  alert_on_new_issue: z.boolean(),
  alert_on_regression: z.boolean(),
  alert_on_unmute: z.boolean(),
});

export const BugsinkEventListSchema = z.object({
  id: z.string(),
  ingested_at: z.string(),
  digested_at: z.string(),
  issue: z.string(),
  grouping: z.number(),
  event_id: z.string(),
  project: z.number(),
  timestamp: z.string(),
  digest_order: z.number(),
});

export const BugsinkEventDetailSchema = z.object({
  id: z.string(),
  ingested_at: z.string(),
  digested_at: z.string(),
  issue: z.string(),
  grouping: z.number(),
  event_id: z.string(),
  project: z.number(),
  timestamp: z.string(),
  digest_order: z.number(),
  data: z.record(z.string(), z.unknown()),
  stacktrace_md: z.string(),
});

export const BugsinkReleaseListSchema = z.object({
  id: z.string(),
  project: z.number(),
  version: z.string(),
  date_released: z.string().nullable(),
});

export const BugsinkReleaseDetailSchema = BugsinkReleaseListSchema.extend({
  semver: z.string(),
  is_semver: z.boolean(),
  sort_epoch: z.number(),
});

export function BugsinkPaginatedResponseSchema<T extends z.ZodType>(
  itemSchema: T,
) {
  return z.object({
    count: z.number().optional(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema),
  });
}
