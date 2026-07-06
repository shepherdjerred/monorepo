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

/**
 * Body for POST /api/tasks/:id/complete-instance.
 *
 * Empty body → toggle today (upstream plugin parity, legacy app behavior).
 * `date` → target that instance instead of server-local today (the client
 * captures the date at tap time, killing device/server timezone skew).
 * `completed` → SET semantics instead of toggle (idempotent — required for
 * safe offline-queue replay; a replayed toggle would undo itself).
 */
export const CompleteInstanceRequestSchema = z.strictObject({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  completed: z.boolean().optional(),
});
export type CompleteInstanceRequest = z.infer<
  typeof CompleteInstanceRequestSchema
>;
