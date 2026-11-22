import { z } from "zod";
import { Priority } from "../protocol/generated.ts";
import { parseRRule } from "./rrule-parser.ts";
import {
  DeadlineSchema,
  FilterAddArgsSchema,
  FilterUpdateArgsSchema,
  LabelAddArgsSchema,
  LabelUpdateArgsSchema,
  RecurrenceBasisSchema,
  ReminderAddArgsSchema,
  ReminderUpdateArgsSchema,
  SectionUpdateArgsSchema,
  TaskMoveArgsSchema,
} from "./schemas.ts";

export const RestPrioritySchema = z.enum([
  Priority.P1,
  Priority.P2,
  Priority.P3,
  Priority.P4,
]);

export const RestRecurrenceRuleCreateSchema = z
  .string()
  .refine(
    (rule) => rule === "" || parseRRule(rule) !== null,
    "recurrence_rule must be a valid RFC 5545 RRULE with FREQ=DAILY|WEEKLY|MONTHLY|YEARLY",
  )
  .optional();

export const RestRecurrenceRuleUpdateSchema = z
  .string()
  .nullable()
  .refine(
    (rule) => rule === null || rule === "" || parseRRule(rule) !== null,
    "recurrence_rule must be a valid RFC 5545 RRULE with FREQ=DAILY|WEEKLY|MONTHLY|YEARLY",
  )
  .optional();

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
  priority: RestPrioritySchema.optional(),
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
  recurrence_rule: RestRecurrenceRuleCreateSchema,
  recurrenceRule: RestRecurrenceRuleCreateSchema,
  label_ids: z.array(z.string()).optional(),
  labelIds: z.array(z.string()).optional(),
});

export const UpdateTaskBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: RestPrioritySchema.optional(),
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
  recurrence_rule: RestRecurrenceRuleUpdateSchema,
  recurrenceRule: RestRecurrenceRuleUpdateSchema,
  label_ids: z.array(z.string()).optional(),
  labelIds: z.array(z.string()).optional(),
  completed: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
});

export const CreateTaskCommentBodySchema = z.object({
  id: z.uuid().optional(),
  body: z.string().trim().max(32_000).default(""),
  created_at: z.iso.datetime().optional(),
  file_name: z.string().min(1).max(255).optional(),
  attachment_base64: z.string().optional(),
});

export const RestTaskMoveBodySchema = TaskMoveArgsSchema.extend({});

export const RestTaskRescheduleBodySchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().min(1),
        due_date: z.string().nullable().optional(),
        due_datetime: z.string().nullable().optional(),
        due_timezone: z.string().nullable().optional(),
        due_string: z.string().nullable().optional(),
      }),
    )
    .min(1),
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

export const CreateSectionBodySchema = z
  .object({
    id: z.string().optional(),
    project_id: z.string().optional(),
    projectId: z.string().optional(),
    name: z.string().min(1),
    section_order: z.number().optional(),
    sectionOrder: z.number().optional(),
  })
  .refine(
    (d) => (d.project_id ?? d.projectId ?? "") !== "",
    "project_id is required",
  );

export const UpdateSectionBodySchema = SectionUpdateArgsSchema.omit({
  id: true,
}).extend({
  sectionOrder: z.number().optional(),
  isArchived: z.boolean().optional(),
  is_deleted: z.boolean().optional(),
});

export const CreateLabelBodySchema = LabelAddArgsSchema.omit({ temp_id: true });
export const UpdateLabelBodySchema = LabelUpdateArgsSchema.omit({
  id: true,
}).extend({
  is_deleted: z.boolean().optional(),
});
export const CreateReminderBodySchema = ReminderAddArgsSchema.omit({
  temp_id: true,
});
export const UpdateReminderBodySchema = ReminderUpdateArgsSchema.omit({
  id: true,
}).extend({
  is_deleted: z.boolean().optional(),
});
export const CreateFilterBodySchema = FilterAddArgsSchema.omit({
  temp_id: true,
});
export const UpdateFilterBodySchema = FilterUpdateArgsSchema.omit({
  id: true,
}).extend({
  is_deleted: z.boolean().optional(),
});
