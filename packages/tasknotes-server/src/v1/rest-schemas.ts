import { z } from "zod";
import {
  DeadlineSchema,
  RecurrenceBasisSchema,
  FilterAddArgsSchema,
  FilterUpdateArgsSchema,
  LabelAddArgsSchema,
  LabelUpdateArgsSchema,
  ReminderAddArgsSchema,
  ReminderUpdateArgsSchema,
} from "./schemas.ts";

export const CreateTaskBodySchema = z.object({
  id: z.string().optional(),
  project_id: z.string().optional(),
  projectId: z.string().optional(),
  section_id: z.string().optional(),
  sectionId: z.string().optional(),
  parent_id: z.string().optional(),
  parentId: z.string().optional(),
  title: z.string().default(""),
  description: z.string().optional(),
  priority: z.string().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  due_date: z.string().optional(),
  due_datetime: z.string().optional(),
  due_timezone: z.string().optional(),
  dueTimezone: z.string().optional(),
  due_string: z.string().optional(),
  dueString: z.string().optional(),
  deadline: DeadlineSchema,
  recurrence_basis: RecurrenceBasisSchema,
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().optional(),
  recurrenceRule: z.string().optional(),
  label_ids: z.array(z.string()).optional(),
  labelIds: z.array(z.string()).optional(),
});

export const UpdateTaskBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.string().optional(),
  project_id: z.string().optional(),
  projectId: z.string().optional(),
  section_id: z.string().nullable().optional(),
  sectionId: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  due_date: z.string().nullable().optional(),
  due_datetime: z.string().nullable().optional(),
  due_timezone: z.string().nullable().optional(),
  dueTimezone: z.string().nullable().optional(),
  due_string: z.string().nullable().optional(),
  dueString: z.string().nullable().optional(),
  deadline: DeadlineSchema,
  recurrence_basis: RecurrenceBasisSchema,
  is_recurring: z.boolean().optional(),
  recurrence_rule: z.string().nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  label_ids: z.array(z.string()).optional(),
  labelIds: z.array(z.string()).optional(),
  completed: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
});

export const CreateProjectBodySchema = z.object({
  id: z.string().optional(),
  name: z.string().default("New Project"),
  color: z.string().optional(),
  parent_id: z.string().optional(),
  parentId: z.string().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  is_favorite: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
});

export const UpdateProjectBodySchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  parent_id: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  child_order: z.number().optional(),
  childOrder: z.number().optional(),
  is_favorite: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
});

export const CreateLabelBodySchema = LabelAddArgsSchema.omit({ temp_id: true });
export const UpdateLabelBodySchema = LabelUpdateArgsSchema.omit({ id: true });
export const CreateReminderBodySchema = ReminderAddArgsSchema.omit({
  temp_id: true,
});
export const UpdateReminderBodySchema = ReminderUpdateArgsSchema.omit({
  id: true,
});
export const CreateFilterBodySchema = FilterAddArgsSchema.omit({
  temp_id: true,
});
export const UpdateFilterBodySchema = FilterUpdateArgsSchema.omit({ id: true });
