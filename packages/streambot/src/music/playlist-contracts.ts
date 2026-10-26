import { z } from "zod";
import { MusicTrackSchema } from "./contracts.ts";

export const PlaylistSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  ownerId: z.string(),
  guildId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  owned: z.boolean(),
  cover: MusicTrackSchema.optional(),
});
export const PlaylistItemSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  music: MusicTrackSchema.optional(),
  selectionId: z.string().optional(),
  matched: z.boolean().optional(),
});
export const PlaylistPageSchema = PlaylistSummarySchema.extend({
  items: z.array(PlaylistItemSchema),
  offset: z.number().int().nonnegative().optional(),
});
export const PlaylistListSchema = z.array(PlaylistSummarySchema);
export type PlaylistSummary = z.infer<typeof PlaylistSummarySchema>;
export const PlaylistMutationSchema = z.object({
  action: z.enum([
    "create",
    "save",
    "rename",
    "delete",
    "publish",
    "private",
    "copy",
    "add",
    "remove",
    "move",
    "match",
  ]),
  guildId: z.string().regex(/^\d+$/u),
  id: z.string().min(1).max(100).optional(),
  revision: z.number().int().nonnegative().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  itemId: z.uuid().optional(),
  position: z.number().int().positive().optional(),
  selectionId: z.string().optional(),
  playback: z.unknown().optional(),
});
