import { z } from "zod";

export const BugsinkProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

export const BugsinkIssueSchema = z.object({
  id: z.string(),
  short_id: z.string(),
  title: z.string(),
  culprit: z.string().nullable(),
  level: z.enum(["fatal", "error", "warning", "info", "debug"]),
  status: z.enum(["unresolved", "resolved", "muted"]),
  count: z.number(),
  user_count: z.number(),
  first_seen: z.string(),
  last_seen: z.string(),
  project: BugsinkProjectSchema,
  metadata: z.object({
    type: z.string().optional(),
    value: z.string().optional(),
    filename: z.string().optional(),
    function: z.string().optional(),
  }),
  is_unhandled: z.boolean(),
  platform: z.string().nullable(),
});

export const BugsinkEventTagSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const BugsinkStacktraceFrameSchema = z.object({
  filename: z.string(),
  function: z.string(),
  module: z.string().nullable(),
  lineno: z.number().nullable(),
  colno: z.number().nullable(),
  abs_path: z.string().nullable(),
  context_line: z.string().nullable(),
  in_app: z.boolean(),
});

export const BugsinkExceptionSchema = z.object({
  type: z.string(),
  value: z.string(),
  module: z.string().nullable(),
  stacktrace: z
    .object({
      frames: z.array(BugsinkStacktraceFrameSchema),
    })
    .nullable(),
});

export const BugsinkEventUserSchema = z.object({
  id: z.string().nullable(),
  email: z.string().nullable(),
  username: z.string().nullable(),
  ip_address: z.string().nullable(),
});

export const BugsinkEventSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  title: z.string(),
  message: z.string().nullable(),
  timestamp: z.string(),
  platform: z.string().nullable(),
  tags: z.array(BugsinkEventTagSchema),
  exception: z
    .object({
      values: z.array(BugsinkExceptionSchema),
    })
    .nullable(),
  user: BugsinkEventUserSchema.nullable(),
});

export function BugsinkPaginatedResponseSchema<T extends z.ZodType>(
  itemSchema: T,
) {
  return z.object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema),
  });
}
