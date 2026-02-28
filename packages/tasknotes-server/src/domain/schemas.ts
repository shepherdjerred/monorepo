import { z } from "zod";

export {
  PrioritySchema,
  TaskStatusSchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  TaskQueryFilterSchema,
  NlpRequestSchema,
} from "tasknotes-types";

// Server-only schemas
export const PomodoroStartSchema = z.object({
  taskId: z.string().optional(),
});
