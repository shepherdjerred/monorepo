import { z } from "zod";

// Server-only schemas
export const PomodoroStartSchema = z.object({
  taskId: z.string().optional(),
});
