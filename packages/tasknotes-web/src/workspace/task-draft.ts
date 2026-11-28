import {
  Priority,
  RecurrenceBasis,
  type Task,
  type TaskUpdateArgs,
} from "@shepherdjerred/facet-protocol";
import { z } from "zod";
import { effectiveCivilDay, isCivilDay } from "./civil-day.ts";
import { isoForWallTime, wallTimeForIso } from "./task-schedule.ts";

const PrioritySchema = z.enum(Priority);
const OptionalDaySchema = z
  .string()
  .refine((value) => value === "" || isCivilDay(value));
const OptionalTimeSchema = z
  .string()
  .refine((value) => value === "" || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));

export function readPriority(raw: string): Priority | undefined {
  const result = PrioritySchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

const TaskDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: PrioritySchema,
  dueDate: OptionalDaySchema,
  dueTime: OptionalTimeSchema,
  deadline: OptionalDaySchema,
  recurrenceRule: z.string(),
  recurrenceBasis: z.enum(RecurrenceBasis),
  projectId: z.string(),
  sectionId: z.string(),
  labelIds: z.array(z.string()),
});

export type TaskDraft = z.infer<typeof TaskDraftSchema>;

export function readTaskDraft(raw: unknown): TaskDraft | undefined {
  const parsed = TaskDraftSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function taskDraft(task: Task, timeZone: string): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: effectiveCivilDay(task, timeZone) ?? "",
    dueTime:
      task.due_datetime === undefined || task.due_datetime === ""
        ? ""
        : wallTimeForIso(task.due_datetime, timeZone),
    deadline: task.deadline ?? "",
    recurrenceRule: task.recurrence_rule ?? "",
    recurrenceBasis: task.recurrence_basis ?? RecurrenceBasis.Scheduled,
    projectId: task.project_id,
    sectionId: task.section_id ?? "",
    labelIds: task.label_ids,
  };
}

export function taskDraftChanges(
  task: Task,
  draft: TaskDraft,
  timeZone: string,
  original = taskDraft(task, timeZone),
): TaskUpdateArgs {
  const patch: TaskUpdateArgs = { id: task.id };
  if (original.title.trim() !== draft.title.trim())
    patch.title = draft.title.trim();
  if (original.description !== draft.description)
    patch.description = draft.description;
  if (original.priority !== draft.priority) patch.priority = draft.priority;
  if (original.projectId !== draft.projectId)
    patch.project_id = draft.projectId;
  if (original.sectionId !== draft.sectionId)
    patch.section_id = draft.sectionId;
  if (original.deadline !== draft.deadline) patch.deadline = draft.deadline;
  if (original.recurrenceRule.trim() !== draft.recurrenceRule.trim())
    patch.recurrence_rule = draft.recurrenceRule.trim();
  if (
    draft.recurrenceRule !== "" &&
    original.recurrenceBasis !== draft.recurrenceBasis
  )
    patch.recurrence_basis = draft.recurrenceBasis;
  if (
    original.labelIds.length !== draft.labelIds.length ||
    draft.labelIds.some((id) => !original.labelIds.includes(id))
  ) {
    patch.label_ids = draft.labelIds;
  }
  if (
    original.dueDate !== draft.dueDate ||
    original.dueTime !== draft.dueTime
  ) {
    patch.due_date = draft.dueDate;
    patch.due_datetime =
      draft.dueDate === "" || draft.dueTime === ""
        ? ""
        : isoForWallTime(draft.dueDate, draft.dueTime, timeZone);
    patch.due_timezone = draft.dueDate === "" ? "" : timeZone;
    patch.due_string = "";
  }
  return patch;
}
