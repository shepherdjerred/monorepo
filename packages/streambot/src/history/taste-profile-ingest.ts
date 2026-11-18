import type { Database } from "bun:sqlite";
import { z } from "zod";
import { canonicalWorkKey } from "@shepherdjerred/streambot/discovery/same-work.ts";
import {
  isBlockedSource,
  isBlockedText,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  SourceSchema,
  sourceIdentity,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";

const MIN_SONG_SECONDS = 45;
const MAX_SONG_SECONDS = 660;
const YOUTUBE_ID_RE = /^[\w-]{11}$/u;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

const RunJoinRowSchema = z.object({
  user_id: z.string(),
  outcome: z.string().nullable(),
  started_at: z.number(),
  provider: z.string(),
  source_json: z.string(),
  title: z.string(),
  channel_name: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  duration_seconds: z.number().nullable(),
});

const FavoriteJoinRowSchema = z.object({
  user_id: z.string(),
  provider: z.string(),
  source_json: z.string(),
  title: z.string(),
  channel_name: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  duration_seconds: z.number().nullable(),
});

const PlaylistItemJoinRowSchema = z.object({
  user_id: z.string(),
  title: z.string(),
  source_json: z.string(),
});

export type TasteAccumulator = {
  source: Source;
  identity: string;
  workKey: string;
  title: string;
  trackLabel: string;
  artists: string[];
  youtubeVideoId: string | undefined;
  thumbnailUrl: string | undefined;
  channel: string | undefined;
  durationSeconds: number | undefined;
  score: number;
  positiveListeners: Set<string>;
  listenerPlays: Map<string, number>;
  skippedCount: number;
};

export function extractTasteYoutubeId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0] ?? "";
      return YOUTUBE_ID_RE.test(id) ? id : undefined;
    }
    if (YOUTUBE_HOSTS.has(host)) {
      const id = parsed.searchParams.get("v") ?? "";
      return YOUTUBE_ID_RE.test(id) ? id : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function cleanArtistChannel(channelName: string | null): string | undefined {
  if (channelName === null) return undefined;
  const cleaned = channelName
    .replace(/\s+-\s+topic$/iu, "")
    .replace(/vevo$/iu, "")
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 80 ? cleaned : undefined;
}

function extractArtistsAndLabel(
  source: Source,
  title: string,
  channelName: string | null,
): { artists: string[]; trackLabel: string } {
  if (source.music !== undefined) {
    const label = `${source.music.artists.join(", ")} — ${source.music.title}`;
    return { artists: [...source.music.artists], trackLabel: label };
  }
  const sep = /\s+[—–-]\s+/u.exec(title);
  if (sep !== null) {
    const artist = title.slice(0, sep.index).trim();
    const song = title
      .slice(sep.index + sep[0].length)
      .replaceAll(/\([^)]*(?:official|video|audio|lyric)[^)]*\)/giu, "")
      .replaceAll(/\[[^\]]*(?:official|video|audio|lyric)[^\]]*\]/giu, "")
      .trim();
    if (
      artist.length >= 2 &&
      artist.length <= 70 &&
      song.length >= 2 &&
      !isBlockedText(artist)
    ) {
      return { artists: [artist], trackLabel: `${artist} — ${song}` };
    }
  }
  const fromChannel = cleanArtistChannel(channelName);
  if (fromChannel !== undefined && !isBlockedText(fromChannel)) {
    return {
      artists: [fromChannel],
      trackLabel: `${fromChannel} — ${title}`,
    };
  }
  return { artists: [], trackLabel: title };
}

function isSongYoutubeCandidate(
  source: Source,
  provider: string,
  durationSeconds: number | null,
  allowUnknownDuration: boolean,
): boolean {
  const isYoutube =
    provider === "youtube" ||
    (source.kind === "url" && extractTasteYoutubeId(source.url) !== undefined);
  if (!isYoutube) return false;
  return durationSeconds === null
    ? allowUnknownDuration
    : durationSeconds >= MIN_SONG_SECONDS &&
        durationSeconds <= MAX_SONG_SECONDS;
}

export function parseMusicSource(input: {
  readonly sourceJson: string;
  readonly provider: string;
  readonly durationSeconds: number | null;
  readonly title: string;
  readonly allowUnknownDuration?: boolean;
}): Source | null {
  let raw: unknown;
  try {
    raw = JSON.parse(input.sourceJson);
  } catch {
    return null;
  }
  const parsed = SourceSchema.safeParse(raw);
  if (!parsed.success) return null;
  const source = parsed.data;
  if (isBlockedSource(source) || isBlockedText(input.title)) return null;
  if (
    source.kind === "url" &&
    (source.sportsEvent !== undefined ||
      sportsEventForSource(source.url) !== null)
  ) {
    return null;
  }
  if (source.music !== undefined) return source;
  return isSongYoutubeCandidate(
    source,
    input.provider,
    input.durationSeconds,
    input.allowUnknownDuration ?? false,
  )
    ? source
    : null;
}

function getOrCreateEntry(
  entries: Map<string, TasteAccumulator>,
  source: Source,
  meta: {
    readonly title: string;
    readonly channelName: string | null;
    readonly thumbnailUrl: string | null;
    readonly durationSeconds: number | null;
  },
): TasteAccumulator {
  const identity = sourceIdentity(source);
  const existing = entries.get(identity);
  if (existing !== undefined) return existing;
  const { artists, trackLabel } = extractArtistsAndLabel(
    source,
    meta.title,
    meta.channelName,
  );
  const workKey = canonicalWorkKey(trackLabel) || canonicalWorkKey(meta.title);
  const created: TasteAccumulator = {
    source,
    identity,
    workKey,
    title: source.music === undefined ? meta.title : trackLabel,
    trackLabel,
    artists,
    youtubeVideoId:
      source.kind === "url" ? extractTasteYoutubeId(source.url) : undefined,
    thumbnailUrl: meta.thumbnailUrl ?? undefined,
    channel: meta.channelName ?? undefined,
    durationSeconds:
      meta.durationSeconds ?? source.music?.durationSeconds ?? undefined,
    score: 0,
    positiveListeners: new Set<string>(),
    listenerPlays: new Map<string, number>(),
    skippedCount: 0,
  };
  entries.set(identity, created);
  return created;
}

function applyRunWeight(
  entry: TasteAccumulator,
  userId: string,
  outcome: string | null,
  weightScale: number,
): void {
  if (outcome === "skipped") {
    entry.score -= 18 * weightScale;
    entry.skippedCount += 1;
    return;
  }
  if (outcome === "removed") {
    entry.score -= 14 * weightScale;
    entry.skippedCount += 1;
    return;
  }
  if (outcome === "failed") {
    entry.score -= 10 * weightScale;
    return;
  }
  const priorPlays = entry.listenerPlays.get(userId) ?? 0;
  entry.listenerPlays.set(userId, priorPlays + 1);
  const repeatFactor = priorPlays < 6 ? 1 : 0.25;
  const base = outcome === "completed" ? 14 : 6;
  entry.score += base * repeatFactor * weightScale;
  entry.positiveListeners.add(userId);
}

export function ingestUserTasteSet(input: {
  readonly database: Database;
  readonly entries: Map<string, TasteAccumulator>;
  readonly userIds: readonly string[];
  readonly guildId: string;
  readonly weightScale: number;
  readonly includeSharedGuildPlaylists: boolean;
}): void {
  if (input.userIds.length === 0) return;
  const placeholders = input.userIds
    .map((_, index) => `?${String(index + 1)}`)
    .join(", ");

  const runRows = z.array(RunJoinRowSchema).parse(
    input.database
      .query(
        `SELECT r.user_id, r.outcome, r.started_at, m.provider, m.source_json,
                m.title, m.channel_name, m.thumbnail_url, m.duration_seconds
           FROM playback_runs r
           JOIN media_items m ON m.id = r.media_item_id
          WHERE r.user_id IN (${placeholders})
          ORDER BY r.started_at DESC
          LIMIT 400`,
      )
      .all(...input.userIds),
  );
  for (const row of runRows) {
    ingestRunRow(input.entries, row, input.weightScale);
  }

  const favRows = z.array(FavoriteJoinRowSchema).parse(
    input.database
      .query(
        `SELECT f.user_id, m.provider, m.source_json, m.title,
                m.channel_name, m.thumbnail_url, m.duration_seconds
           FROM favorites f
           JOIN media_items m ON m.id = f.media_item_id
          WHERE f.user_id IN (${placeholders})
          ORDER BY f.created_at DESC
          LIMIT 200`,
      )
      .all(...input.userIds),
  );
  for (const row of favRows) {
    const source = parseMusicSource({
      sourceJson: row.source_json,
      provider: row.provider,
      durationSeconds: row.duration_seconds,
      title: row.title,
      allowUnknownDuration: true,
    });
    if (source === null) continue;
    const entry = getOrCreateEntry(input.entries, source, {
      title: row.title,
      channelName: row.channel_name,
      thumbnailUrl: row.thumbnail_url,
      durationSeconds: row.duration_seconds,
    });
    entry.score += 30 * input.weightScale;
    entry.positiveListeners.add(row.user_id);
  }

  ingestUserPlaylists(input, placeholders);
}

function ingestRunRow(
  entries: Map<string, TasteAccumulator>,
  row: z.infer<typeof RunJoinRowSchema>,
  weightScale: number,
): void {
  const source = parseMusicSource({
    sourceJson: row.source_json,
    provider: row.provider,
    durationSeconds: row.duration_seconds,
    title: row.title,
  });
  if (source === null) return;
  const entry = getOrCreateEntry(entries, source, {
    title: row.title,
    channelName: row.channel_name,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: row.duration_seconds,
  });
  applyRunWeight(entry, row.user_id, row.outcome, weightScale);
}

function ingestPlaylistRow(
  entries: Map<string, TasteAccumulator>,
  row: z.infer<typeof PlaylistItemJoinRowSchema>,
  bonus: number,
  recordPositiveListener: boolean,
): void {
  const source = parseMusicSource({
    sourceJson: row.source_json,
    provider: "youtube",
    durationSeconds: null,
    title: row.title,
    allowUnknownDuration: true,
  });
  if (source === null) return;
  const entry = getOrCreateEntry(entries, source, {
    title: row.title,
    channelName: null,
    thumbnailUrl: null,
    durationSeconds: null,
  });
  entry.score += bonus;
  if (recordPositiveListener) entry.positiveListeners.add(row.user_id);
}

function ingestUserPlaylists(
  input: {
    readonly database: Database;
    readonly entries: Map<string, TasteAccumulator>;
    readonly userIds: readonly string[];
    readonly guildId: string;
    readonly weightScale: number;
    readonly includeSharedGuildPlaylists: boolean;
  },
  placeholders: string,
): void {
  const whereClause = input.includeSharedGuildPlaylists
    ? `p.user_id IN (${placeholders}) OR p.guild_id = ?${String(input.userIds.length + 1)}`
    : `p.user_id IN (${placeholders})`;
  const args = input.includeSharedGuildPlaylists
    ? [...input.userIds, input.guildId]
    : [...input.userIds];
  const playlistRows = z.array(PlaylistItemJoinRowSchema).parse(
    input.database
      .query(
        `SELECT p.user_id, i.title, i.source_json
           FROM music_playlists p
           JOIN music_playlist_items i ON i.playlist_id = p.id
          WHERE ${whereClause}
          ORDER BY i.position ASC
          LIMIT 300`,
      )
      .all(...args),
  );
  for (const row of playlistRows) {
    ingestPlaylistRow(input.entries, row, 22 * input.weightScale, true);
  }
}

export function ingestGuildServerTaste(input: {
  readonly database: Database;
  readonly entries: Map<string, TasteAccumulator>;
  readonly guildId: string;
  readonly weightScale: number;
  readonly skipUsers: ReadonlySet<string>;
}): void {
  const runRows = z.array(RunJoinRowSchema).parse(
    input.database
      .query(
        `SELECT r.user_id, r.outcome, r.started_at, m.provider, m.source_json,
                m.title, m.channel_name, m.thumbnail_url, m.duration_seconds
           FROM playback_runs r
           JOIN media_items m ON m.id = r.media_item_id
          WHERE r.guild_id = ?1
          ORDER BY r.started_at DESC
          LIMIT 400`,
      )
      .all(input.guildId),
  );
  for (const row of runRows) {
    if (input.skipUsers.has(row.user_id)) continue;
    ingestRunRow(input.entries, row, input.weightScale);
  }

  const playlistRows = z.array(PlaylistItemJoinRowSchema).parse(
    input.database
      .query(
        `SELECT p.user_id, i.title, i.source_json
           FROM music_playlists p
           JOIN music_playlist_items i ON i.playlist_id = p.id
          WHERE p.guild_id = ?1
          ORDER BY i.position ASC
          LIMIT 200`,
      )
      .all(input.guildId),
  );
  for (const row of playlistRows) {
    if (input.skipUsers.has(row.user_id)) continue;
    ingestPlaylistRow(input.entries, row, 20 * input.weightScale, false);
  }
}
