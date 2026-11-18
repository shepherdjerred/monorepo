import { z } from "zod";
import { Priority } from "../protocol/generated.ts";

const PrioritySchema = z.enum([
  Priority.P1,
  Priority.P2,
  Priority.P3,
  Priority.P4,
]);

export const QueuedCommandEnvelopeSchema = z.object({
  uuid: z.string(),
  temp_id: z.string().optional(),
  command: z.object({
    type: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
});

export const SyncRequestSchema = z.object({
  sync_token: z.string().optional(),
  resource_types: z.array(z.string()).optional(),
  commands: z.array(QueuedCommandEnvelopeSchema).default([]),
});

const TaskOptionalFieldsSchema = z.object({
  description: z.string().optional(),
  priority: PrioritySchema.optional(),
  section_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  child_order: z.number().optional(),
  due_date: z.string().nullable().optional(),
  due_datetime: z.string().nullable().optional(),
  due_timezone: z.string().nullable().optional(),
  due_string: z.string().nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
  label_ids: z.array(z.string()).optional(),
});

export const TaskAddArgsSchema = TaskOptionalFieldsSchema.extend({
  id: z.string().optional(),
  temp_id: z.string().optional(),
  title: z.string(),
  project_id: z.string().default(""),
});

export const TaskUpdateArgsSchema = TaskOptionalFieldsSchema.extend({
  id: z.string().min(1),
  title: z.string().optional(),
  project_id: z.string().optional(),
});

const IdOnlyArgsSchema = z.object({
  id: z.string().min(1),
});

export const TaskCompleteArgsSchema = z.object({
  id: z.string().min(1),
  completed_at: z.string().nullable().optional(),
});

export const TaskReorderArgsSchema = z.object({
  id: z.string().min(1),
  child_order: z.number(),
});

export const ProjectAddArgsSchema = z.object({
  id: z.string().optional(),
  temp_id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  child_order: z.number().optional(),
  is_favorite: z.boolean().optional(),
});

export const ProjectUpdateArgsSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  color: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  child_order: z.number().optional(),
  is_favorite: z.boolean().optional(),
  is_archived: z.boolean().optional(),
});

export const SectionAddArgsSchema = z.object({
  id: z.string().optional(),
  temp_id: z.string().optional(),
  project_id: z.string().min(1),
  name: z.string().min(1),
  section_order: z.number().optional(),
});

export const SectionUpdateArgsSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  section_order: z.number().optional(),
  is_archived: z.boolean().optional(),
});

export const LabelAddArgsSchema = z.object({
  id: z.string().optional(),
  temp_id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().optional(),
  item_order: z.number().optional(),
  is_favorite: z.boolean().optional(),
});

export const LabelUpdateArgsSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  color: z.string().optional(),
  item_order: z.number().optional(),
  is_favorite: z.boolean().optional(),
});

export const ReminderAddArgsSchema = z.object({
  id: z.string().optional(),
  temp_id: z.string().optional(),
  task_id: z.string().min(1),
  reminder_type: z.string().min(1),
  minute_offset: z.number().int().nullable().optional(),
  due_datetime: z.string().nullable().optional(),
});

export const ReminderUpdateArgsSchema = z.object({
  id: z.string().min(1),
  reminder_type: z.string().optional(),
  minute_offset: z.number().int().nullable().optional(),
  due_datetime: z.string().nullable().optional(),
  is_notified: z.boolean().optional(),
});

export const FilterAddArgsSchema = LabelAddArgsSchema.extend({
  query: z.string(),
});

export const FilterUpdateArgsSchema = LabelUpdateArgsSchema.extend({
  query: z.string().optional(),
});

export const ValidatedSyncCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TaskAdd"), args: TaskAddArgsSchema }),
  z.object({ type: z.literal("TaskUpdate"), args: TaskUpdateArgsSchema }),
  z.object({ type: z.literal("TaskDelete"), args: IdOnlyArgsSchema }),
  z.object({ type: z.literal("TaskComplete"), args: TaskCompleteArgsSchema }),
  z.object({ type: z.literal("TaskUncomplete"), args: IdOnlyArgsSchema }),
  z.object({ type: z.literal("TaskReorder"), args: TaskReorderArgsSchema }),
  z.object({ type: z.literal("ProjectAdd"), args: ProjectAddArgsSchema }),
  z.object({ type: z.literal("ProjectUpdate"), args: ProjectUpdateArgsSchema }),
  z.object({ type: z.literal("ProjectDelete"), args: IdOnlyArgsSchema }),
  z.object({ type: z.literal("SectionAdd"), args: SectionAddArgsSchema }),
  z.object({ type: z.literal("SectionUpdate"), args: SectionUpdateArgsSchema }),
  z.object({ type: z.literal("SectionDelete"), args: IdOnlyArgsSchema }),
  z.object({ type: z.literal("LabelAdd"), args: LabelAddArgsSchema }),
  z.object({ type: z.literal("LabelUpdate"), args: LabelUpdateArgsSchema }),
  z.object({ type: z.literal("LabelDelete"), args: IdOnlyArgsSchema }),
  z.object({ type: z.literal("ReminderAdd"), args: ReminderAddArgsSchema }),
  z.object({
    type: z.literal("ReminderUpdate"),
    args: ReminderUpdateArgsSchema,
  }),
  z.object({ type: z.literal("ReminderDelete"), args: IdOnlyArgsSchema }),
  z.object({ type: z.literal("FilterAdd"), args: FilterAddArgsSchema }),
  z.object({ type: z.literal("FilterUpdate"), args: FilterUpdateArgsSchema }),
  z.object({ type: z.literal("FilterDelete"), args: IdOnlyArgsSchema }),
]);

export type ValidatedSyncCommand = z.infer<typeof ValidatedSyncCommandSchema>;
