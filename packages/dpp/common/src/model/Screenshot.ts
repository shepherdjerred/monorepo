import { z } from "zod";

export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;
export const ScreenshotRequestSchema = z.strictObject({ kind: z.literal("screenshot") });

export type ScreenshotResponse = z.infer<typeof ScreenshotResponseSchema>;
export const ScreenshotResponseSchema = z.strictObject({
  kind: z.literal("screenshot"),
  value: z.string(),
});
