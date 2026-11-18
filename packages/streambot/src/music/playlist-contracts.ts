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
  notice: z.string().optional(),
});
export const PlaylistListSchema = z.array(PlaylistSummarySchema);
export type PlaylistSummary = z.infer<typeof PlaylistSummarySchema>;
export const PlaylistMutationSchema = z.object({
  action: z.enum([
    "create",
    "save",
    "import",
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
  url: z.string().trim().min(1).max(500).optional(),
  itemId: z.uuid().optional(),
  position: z.number().int().positive().optional(),
  selectionId: z.string().optional(),
  playback: z.unknown().optional(),
});

/** Browser-safe check for public Spotify track/album/playlist URLs and playlist URLs. */
export function isImportablePlaylistUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }
  if (
    url.protocol === "https:" &&
    url.hostname === "open.spotify.com" &&
    url.username === "" &&
    url.password === "" &&
    url.port === ""
  ) {
    const path = url.pathname.replace(/^\/intl-[a-z]+\//u, "/");
    return /^\/(?:track|album|playlist)\/[A-Za-z0-9]+\/?$/u.test(path);
  }
  return (
    url.searchParams.has("list") || /\/playlist(?:\/|$)/u.test(url.pathname)
  );
}
