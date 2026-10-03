import { z } from "zod";
import { isRemoteArtworkUrl } from "./artwork.ts";

const ArtworkUrlSchema = z
  .string()
  .refine(
    (value) => value.startsWith("/api/artwork?") || isRemoteArtworkUrl(value),
  );

export const GuildSchema = z.strictObject({ id: z.string(), name: z.string() });
export const IdentitySchema = z.strictObject({
  userId: z.string().regex(/^\d+$/u),
  username: z.string(),
  guildIds: z.array(z.string()),
});
export type WebIdentity = z.infer<typeof IdentitySchema>;
export const MeSchema = z.strictObject({
  user: IdentitySchema,
  guilds: z.array(GuildSchema),
  csrfToken: z.string(),
});
export const LibraryItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  library: z.string(),
  year: z.number().optional(),
  series: z.string().optional(),
  season: z.number().optional(),
  episode: z.number().optional(),
  artworkUrl: ArtworkUrlSchema.optional(),
});
export const LibraryPageSchema = z.strictObject({
  items: z.array(LibraryItemSchema),
  total: z.number(),
  libraries: z.array(z.string()),
  series: z.array(z.string()),
});
export const CandidateSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  provider: z.enum(["local", "history", "youtube"]),
  channel: z.string().optional(),
  durationSeconds: z.number().optional(),
  artworkUrl: ArtworkUrlSchema.optional(),
});
export const SearchResultsSchema = z.array(CandidateSchema);
export const MediaSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("library"), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal("candidate"), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal("sports"), id: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.url().refine((value) => /^https?:\/\//u.test(value)),
  }),
]);
export const PlayerItemSchema = z.strictObject({
  title: z.string(),
  durationSeconds: z.number().nullable(),
  mediaKind: z.enum(["music", "video"]).nullable(),
  artworkUrl: ArtworkUrlSchema.optional(),
});
export const SnapshotSchema = z.strictObject({
  channel: GuildSchema.nullable(),
  revision: z.string().nullable(),
  state: z.string(),
  current: PlayerItemSchema.nullable(),
  queue: z.array(PlayerItemSchema),
  positionSeconds: z.number().nullable(),
  paused: z.boolean(),
  volume: z.number(),
  loop: z.string(),
  advancedControls: z.boolean(),
  sportsEnabled: z.boolean(),
  restrictedLive: z.boolean(),
});
export type WebSnapshot = z.infer<typeof SnapshotSchema>;

const commandBase = {
  guildId: z.string().regex(/^\d+$/u),
  channelId: z.string().regex(/^\d+$/u),
  revision: z.string().nullable(),
};
const SimpleCommandSchema = z.strictObject({
  ...commandBase,
  action: z.enum(["pause", "resume", "skip", "stop", "clear", "shuffle"]),
});
export const CommandSchema = z.union([
  SimpleCommandSchema,
  z.strictObject({
    ...commandBase,
    action: z.literal("play"),
    selection: MediaSelectionSchema,
    placement: z.enum(["queue", "next", "now"]),
  }),
  z.strictObject({
    ...commandBase,
    action: z.literal("seek"),
    seconds: z.number().min(0),
  }),
  z.strictObject({
    ...commandBase,
    action: z.literal("volume"),
    percent: z.number().min(0).max(200),
  }),
  z.strictObject({
    ...commandBase,
    action: z.literal("loop"),
    mode: z.enum(["off", "track", "queue"]),
  }),
  z.strictObject({
    ...commandBase,
    action: z.literal("remove"),
    position: z.number().int().positive(),
  }),
  z.strictObject({
    ...commandBase,
    action: z.literal("move"),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
  }),
  z.strictObject({
    ...commandBase,
    action: z.literal("subtitles"),
    token: z.string().min(1),
  }),
]);
export type WebCommand = z.infer<typeof CommandSchema>;
export const CommandResultSchema = z.strictObject({ message: z.string() });
export const SubtitleMenuSchema = z.strictObject({
  revision: z.string(),
  tracks: z.array(z.strictObject({ token: z.string(), label: z.string() })),
});
export const ErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
});
export const LibraryQuerySchema = z.object({
  query: z.string().max(300).default(""),
  library: z.string().default(""),
  series: z.string().default(""),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export const SearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(300),
  source: z.enum(["auto", "local", "youtube", "history"]).default("auto"),
});
export const SportsQuerySchema = z.object({
  query: z.string().trim().max(300).default(""),
  provider: z
    .enum(["auto", "streameast", "tvsportslive"])
    .default("streameast"),
});
export const SportsResultsSchema = z.array(
  z.strictObject({
    id: z.string(),
    title: z.string(),
    provider: z.enum(["streameast", "tvsportslive"]),
    status: z.enum(["live", "scheduled", "unknown"]),
    startsAt: z.iso.datetime().nullable(),
  }),
);
