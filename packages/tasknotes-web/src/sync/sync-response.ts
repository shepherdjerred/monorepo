import {
  Priority,
  RecurrenceBasis,
  type SyncResponse,
} from "@shepherdjerred/facet-protocol";
import { z } from "zod";

const PrioritySchema = z.enum(Priority);

const TaskSchema = z.looseObject({
  id: z.string(),
  user_id: z.string(),
  project_id: z.string(),
  section_id: z.string().optional(),
  parent_id: z.string().optional(),
  title: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  child_order: z.number(),
  due_date: z.string().optional(),
  due_datetime: z.string().optional(),
  due_timezone: z.string().optional(),
  due_string: z.string().optional(),
  deadline: z.string().optional(),
  is_recurring: z.boolean(),
  recurrence_rule: z.string().optional(),
  recurrence_basis: z.enum(RecurrenceBasis).optional(),
  label_ids: z.array(z.string()),
  completed: z.boolean(),
  completed_at: z.string().optional(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  comments: z
    .array(
      z.object({
        id: z.string(),
        body: z.string(),
        created_at: z.string(),
        file_name: z.string().optional(),
      }),
    )
    .optional(),
});

const ProjectSchema = z.looseObject({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  color: z.string(),
  parent_id: z.string().optional(),
  child_order: z.number(),
  is_inbox: z.boolean(),
  is_favorite: z.boolean(),
  is_archived: z.boolean(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const SectionSchema = z.looseObject({
  id: z.string(),
  project_id: z.string(),
  user_id: z.string(),
  name: z.string(),
  section_order: z.number(),
  is_archived: z.boolean(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const LabelSchema = z.looseObject({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  color: z.string(),
  item_order: z.number(),
  is_favorite: z.boolean(),
  is_deleted: z.boolean(),
});

const ReminderSchema = z.looseObject({
  id: z.string(),
  task_id: z.string(),
  reminder_type: z.string(),
  minute_offset: z.number().optional(),
  due_datetime: z.string().optional(),
  is_notified: z.boolean(),
  is_deleted: z.boolean(),
  updated_at: z.string(),
});

const FilterSchema = z.looseObject({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  query: z.string(),
  color: z.string(),
  item_order: z.number(),
  is_favorite: z.boolean(),
  is_deleted: z.boolean(),
});

export const WorkspaceResourcesSchema = z.object({
  tasks: z.array(TaskSchema),
  projects: z.array(ProjectSchema),
  sections: z.array(SectionSchema),
  labels: z.array(LabelSchema),
  reminders: z.array(ReminderSchema),
  filters: z.array(FilterSchema),
});

const SyncBodySchema = WorkspaceResourcesSchema.extend({
  sync_token: z.string(),
  full_sync: z.boolean(),
  temp_id_mapping: z.record(z.string(), z.string()),
  sync_status: z.record(z.string(), z.string()),
});

export const SyncResponseSchema = z.custom<SyncResponse>((value) => {
  return SyncBodySchema.safeParse(value).success;
});
