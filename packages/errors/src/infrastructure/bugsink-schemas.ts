import { z } from "zod";

export const BugsinkProjectItemSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    slug: z.string(),
    dsn: z.string().optional(),
    digested_event_count: z.number().int().nonnegative().default(0),
    stored_event_count: z.number().int().nonnegative().default(0),
    alert_on_new_issue: z.boolean().default(true),
    alert_on_regression: z.boolean().default(true),
  })
  .loose();

export const BugsinkReleaseItemSchema = z
  .object({
    id: z.string().min(1),
    project: z.number().int().positive(),
    version: z.string(),
    date_released: z.string().nullable().optional(),
  })
  .loose();

export const BugsinkIssueItemSchema = z
  .object({
    id: z.uuid(),
    project: z.number().int().positive(),
    last_seen: z.string(),
    first_seen: z.string(),
    digested_event_count: z.number().int().nonnegative(),
    stored_event_count: z.number().int().nonnegative(),
    calculated_type: z.string(),
    calculated_value: z.string(),
    transaction: z.string().default(""),
    is_resolved: z.boolean(),
    is_resolved_by_next_release: z.boolean().default(false),
    is_muted: z.boolean(),
  })
  .loose();

export const BugsinkEventListItemSchema = z
  .object({
    id: z.uuid(),
    event_id: z.string().min(1),
    issue: z.uuid(),
    project: z.number().int().positive(),
    timestamp: z.string(),
    ingested_at: z.string().optional(),
  })
  .loose();

export const BugsinkEventDetailSchema = z
  .object({
    id: z.uuid(),
    event_id: z.string().min(1),
    issue: z.uuid(),
    project: z.number().int().positive(),
    timestamp: z.string(),
    ingested_at: z.string().optional(),
    data: z.record(z.string(), z.unknown()),
    stacktrace_md: z.string().default(""),
  })
  .loose();

export function createPaginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    next: z.string().nullable().optional(),
    results: z.array(itemSchema),
  });
}
