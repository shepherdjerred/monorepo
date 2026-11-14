import { z } from "zod";

/** Optional on the native wire; absence never becomes a measured zero. */
export const PlexViewCountSchema = z.int().nonnegative().max(2_147_483_647);
export const NativeWatchValueSchema = z.strictObject({
  watched: z.boolean(),
  viewCount: PlexViewCountSchema.nullable(),
});
export const NativeCompletionWindowSchema = z
  .strictObject({
    previousObservedAt: z.date(),
    completedObservedAt: z.date(),
  })
  .refine((value) => value.previousObservedAt <= value.completedObservedAt);
export type NativeWatchValue = z.infer<typeof NativeWatchValueSchema>;
