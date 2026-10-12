import { z } from "zod";

export const QueuedDisplaySchema = z.strictObject({
  title: z.string().min(1),
  thumbnailUrl: z.url().optional(),
  durationSeconds: z.number().nonnegative().optional(),
});
export type QueuedDisplay = z.infer<typeof QueuedDisplaySchema>;
