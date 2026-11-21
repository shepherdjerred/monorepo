import { z } from "zod";
import { isRemoteArtworkUrl } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import { SportsArtworkSchema } from "@shepherdjerred/streambot/sports/artwork.ts";
import { HistoryProviderSchema } from "@shepherdjerred/streambot/history/provider.ts";

export const ArtworkUrlSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/api/artwork?") ||
      value.startsWith("/api/music/artwork?") ||
      isRemoteArtworkUrl(value),
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
  /** Random pseudonym for usage analytics; `null` only when the id store is full. */
  analyticsId: z.uuid().nullable(),
  /**
   * The Bugsink project, release and environment the server itself reports under, for browser
   * error reports; `null` when Bugsink is off or its DSN is not on the public Bugsink host.
   */
  bugsink: z
    .strictObject({
      dsn: z.url(),
      release: z.string().nullable(),
      environment: z.string(),
    })
    .nullable(),
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
export const LibraryTitleSchema = z.discriminatedUnion("kind", [
  LibraryItemSchema.extend({ kind: z.literal("file") }),
  z.strictObject({
    kind: z.literal("series"),
    id: z.string(),
    title: z.string(),
    series: z.string(),
    library: z.string(),
    episodes: z.number().int().positive(),
    seasons: z.number().int().nonnegative(),
    artworkUrl: ArtworkUrlSchema.optional(),
  }),
]);
export const LibraryTitlesPageSchema = z.strictObject({
  view: z.literal("titles"),
  items: z.array(LibraryTitleSchema),
  total: z.number(),
  libraries: z.array(z.string()),
  series: z.array(z.string()),
});
export const LibraryBrowsePageSchema = z.union([
  LibraryTitlesPageSchema,
  LibraryPageSchema,
]);
export const MediaSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("history"), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal("library"), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal("candidate"), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal("sports"), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal("music"), id: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("playlist"),
    id: z.string().min(1).max(100),
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.url().refine((value) => /^https?:\/\//u.test(value)),
  }),
]);
export const PlayerItemSchema = z.strictObject({
  music: z.boolean().optional(),
  requester: z.strictObject({ id: z.string(), name: z.string() }).optional(),
  queuedAt: z.number().int().nonnegative().nullable().optional(),
  sportsArtwork: SportsArtworkSchema.optional(),
  title: z.string(),
  durationSeconds: z.number().nullable(),
  mediaKind: z.enum(["music", "video"]).nullable(),
  artworkUrl: ArtworkUrlSchema.optional(),
  /** Opaque identity of this queue entry; send it back as `expectCurrent` once it is playing. */
  token: z.string().optional(),
});
export const WebStationScopeSchema = z.enum(["room", "mine", "server"]);
export const WebTvPresetSchema = z.enum([
  "my-mix",
  "continue-series",
  "sitcoms",
  "movies",
  "youtube",
]);
export const WebStationSchema = z.strictObject({
  kind: z.enum(["radio", "tv"]),
  scope: WebStationScopeSchema,
  seed: z.string().trim().min(1).max(200).optional(),
  tvPreset: WebTvPresetSchema.optional(),
});
export type WebStation = z.infer<typeof WebStationSchema>;

/**
 * Every command names its target: the viewer's voice channel and the slot of the player card it
 * came from (`playbackChannel`). `null` lets the server use the slot the action implies — Listen
 * and Radio on 1, Watch and TV on 2 — and is the only value a legacy room's single queue accepts.
 */
const commandBase = {
  guildId: z.string().regex(/^\d+$/u),
  channelId: z.string().regex(/^\d+$/u),
  revision: z.string().nullable(),
  playbackChannel: z.number().int().positive().nullable().default(null),
};
/** Listen is voice audio everyone in the channel hears; Watch is a Go Live stream. */
export const TransportSchema = z.enum(["listen", "watch"]);
export type WebTransport = z.infer<typeof TransportSchema>;
/** An item token from the snapshot; a stale click on a different item is refused. */
const expectCurrent = z.string().min(1).max(100).optional();
const CurrentItemCommandSchema = z.strictObject({
  ...commandBase,
  action: z.enum(["pause", "resume", "skip"]),
  expectCurrent,
});
const SimpleCommandSchema = z.strictObject({
  ...commandBase,
  action: z.enum(["stop", "clear", "shuffle"]),
});
export const CommandSchema = z.union([
  CurrentItemCommandSchema,
  SimpleCommandSchema,
  z.strictObject({
    ...commandBase,
    action: z.literal("play"),
    selection: MediaSelectionSchema,
    placement: z.enum(["queue", "next", "now"]),
    /** The destination: Listen plays voice audio on slot 1, Watch streams on slot 2 or higher. */
    transport: TransportSchema,
  }),
  z.strictObject({
    ...commandBase,
    action: z.literal("seek"),
    seconds: z.number().min(0),
    expectCurrent,
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
  z.strictObject({
    ...commandBase,
    action: z.literal("station"),
    mode: z.enum(["radio", "tv", "off"]),
    scope: WebStationScopeSchema.optional(),
    seed: z.string().trim().min(1).max(200).optional(),
    tvPreset: WebTvPresetSchema.optional(),
  }),
]);
export type WebCommand = z.infer<typeof CommandSchema>;
export const CommandResultSchema = z.strictObject({
  message: z.string(),
  /** Where a play request went. The channel name is for the requesting viewer only. */
  destination: z
    .strictObject({
      transport: TransportSchema,
      voiceChannelName: z.string(),
    })
    .optional(),
  /** The first played item's 1-based place in the queue, or `0` when it is starting right away. */
  position: z.number().int().nonnegative().optional(),
});
export type WebCommandResult = z.infer<typeof CommandResultSchema>;
export const SubtitleMenuSchema = z.strictObject({
  revision: z.string(),
  tracks: z.array(z.strictObject({ token: z.string(), label: z.string() })),
});
export const ErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
});
export const LibraryQuerySchema = z.object({
  view: z.enum(["entries", "titles"]).default("entries"),
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
    .enum(["auto", "streameast", "tvsportslive", "lolesports"])
    .default("streameast"),
  league: z
    .enum(["", "lck", "worlds", "msi", "first_stand", "lpl", "lec", "lcs"])
    .default(""),
  range: z.enum(["today", "week"]).default("today"),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    })
    .default("UTC"),
});
export const SportsResultsSchema = z.array(
  z.strictObject({
    id: z.string(),
    title: z.string(),
    provider: z.enum(["streameast", "tvsportslive", "lolesports"]),
    status: z.enum(["live", "scheduled", "unknown"]),
    startsAt: z.iso.datetime().nullable(),
    sportsArtwork: SportsArtworkSchema.optional(),
    canSchedule: z.boolean().optional(),
    proOnly: z.literal(true).optional(),
  }),
);

export const HistoryQuerySchema = z.object({
  visibility: z.enum(["mine", "server"]).default("mine"),
  query: z.string().trim().max(300).default(""),
  provider: z.union([z.literal(""), HistoryProviderSchema]).default(""),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export const HistoryPageSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  items: z.array(
    PlayerItemSchema.extend({
      id: z.string(),
      provider: HistoryProviderSchema,
      playedAt: z.number().int().nonnegative(),
      endedAt: z.number().int().nonnegative().nullable(),
      outcome: z.string().nullable(),
      replayAvailable: z.boolean(),
      /** The replay buttons, decided as for a search row of the same kind; empty when not replayable. */
      actions: z.array(TransportSchema),
      /** Further replay choices for the item's overflow menu; absent when there are none. */
      menuActions: z.array(TransportSchema).min(1).optional(),
    }),
  ),
});

/**
 * A room queue entry. For a track with its own artists, `title` is the track alone and `subtitle`
 * the artist line; otherwise `subtitle` is absent and `title` is the item's full label.
 */
export const RoomPlayerItemSchema = PlayerItemSchema.extend({
  subtitle: z.string().min(1).optional(),
});

/** One playback slot of the viewer's room: voice audio (`listen`, slot 1) or a Go Live stream. */
export const RoomPlayerSchema = z.strictObject({
  slot: z.number().int().positive(),
  transport: TransportSchema,
  revision: z.string().nullable(),
  state: z.string(),
  current: RoomPlayerItemSchema.nullable(),
  queue: z.array(RoomPlayerItemSchema),
  positionSeconds: z.number().nullable(),
  /** Server epoch milliseconds at which `positionSeconds` was sampled. */
  positionAt: z.number().int().nonnegative(),
  paused: z.boolean(),
  volume: z.number(),
  loop: z.string(),
  station: WebStationSchema.nullable(),
  restrictedLive: z.boolean(),
});
export const RoomCapabilitiesSchema = z.strictObject({
  listen: z.boolean(),
  sports: z.boolean(),
  history: z.boolean(),
  radio: z.boolean(),
  tv: z.boolean(),
  pause: z.boolean(),
  playNow: z.boolean(),
  lolEsports: z.boolean(),
  musicCatalog: z.boolean(),
  playlists: z.boolean(),
  spotifyLinks: z.boolean(),
  plexPosters: z.boolean(),
});
/** Everything the web remote needs about where the viewer is and what is playing there. */
export const RoomSchema = z.strictObject({
  location: z
    .strictObject({ guild: GuildSchema, channel: GuildSchema })
    .nullable(),
  guilds: z.array(GuildSchema),
  browseGuildId: z.string(),
  players: z.array(RoomPlayerSchema),
  capacity: z.strictObject({
    maxSlots: z.number().int().positive(),
    /**
     * False in a legacy room (one mixed queue, or numbered channels off) and when the viewer is in
     * no voice channel; commands there send `playbackChannel: null`.
     */
    numbered: z.boolean(),
    extraStreamAvailable: z.boolean(),
  }),
  capabilities: RoomCapabilitiesSchema,
  /** Server epoch milliseconds when this snapshot was built. */
  serverTime: z.number().int().nonnegative(),
});
export type WebRoom = z.infer<typeof RoomSchema>;
export type WebRoomPlayer = z.infer<typeof RoomPlayerSchema>;

/** The closed `code` of a terminal `error` event on `/api/room/events`. */
export const RoomStreamErrorSchema = z.strictObject({
  code: z.enum([
    "unauthorized",
    "guild_denied",
    "feature_disabled",
    "unavailable",
  ]),
});
