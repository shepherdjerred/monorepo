import { z } from "zod";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

export const MAX_STATION_RECENT_IDENTITIES = 80;
export const MAX_STATION_SKIPPED_IDENTITIES = 40;

export const TvPresetSchema = z.enum([
  "my-mix",
  "continue-series",
  "sitcoms",
  "movies",
  "youtube",
]);
export type TvPreset = z.infer<typeof TvPresetSchema>;

export const StationScopeSchema = z.enum(["room", "mine", "server"]);
export type StationScope = z.infer<typeof StationScopeSchema>;

export const StationKindSchema = z.enum(["radio", "tv"]);
export type StationKind = z.infer<typeof StationKindSchema>;

export const PersistedStationSchema = z.strictObject({
  kind: StationKindSchema,
  scope: StationScopeSchema,
  ownerId: UserIdSchema,
  seed: z.string().trim().min(1).max(200).optional(),
  tvPreset: TvPresetSchema.optional(),
  recentIdentities: z
    .array(z.string())
    .max(MAX_STATION_RECENT_IDENTITIES)
    .default([]),
  skippedIdentities: z
    .array(z.string())
    .max(MAX_STATION_SKIPPED_IDENTITIES)
    .default([]),
});
export type PersistedStation = z.infer<typeof PersistedStationSchema>;

export function appendStationRingBuffer(
  items: readonly string[],
  next: string,
  max: number,
): string[] {
  const updated = items.filter((item) => item !== next);
  updated.push(next);
  return updated.length > max ? updated.slice(updated.length - max) : updated;
}
