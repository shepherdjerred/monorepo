import type { MusicTrackInfo } from "./metadata.ts";

export type InMemoryPlaylist = {
  name: string;
  tracks: MusicTrackInfo[];
  createdAt: Date;
  updatedAt: Date;
};

type PlaylistResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const playlistsByGuild = new Map<string, Map<string, InMemoryPlaylist>>();

function normalizePlaylistKey(name: string): string {
  return name.trim().toLowerCase();
}

function getGuildPlaylists(guildId: string): Map<string, InMemoryPlaylist> {
  let playlists = playlistsByGuild.get(guildId);
  if (playlists == null) {
    playlists = new Map();
    playlistsByGuild.set(guildId, playlists);
  }
  return playlists;
}

function clonePlaylist(playlist: InMemoryPlaylist): InMemoryPlaylist {
  return {
    name: playlist.name,
    tracks: playlist.tracks.map((track) => ({ ...track })),
    createdAt: new Date(playlist.createdAt),
    updatedAt: new Date(playlist.updatedAt),
  };
}

export function clearAllPlaylistsForTests(): void {
  playlistsByGuild.clear();
}

export function createPlaylist(
  guildId: string,
  name: string,
): PlaylistResult<InMemoryPlaylist> {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, message: "playlist name is required" };
  }
  const playlists = getGuildPlaylists(guildId);
  const key = normalizePlaylistKey(trimmedName);
  if (playlists.has(key)) {
    return { ok: false, message: `Playlist "${trimmedName}" already exists` };
  }
  const now = new Date();
  const playlist = {
    name: trimmedName,
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
  playlists.set(key, playlist);
  return { ok: true, value: clonePlaylist(playlist) };
}

export function deletePlaylist(
  guildId: string,
  name: string,
): PlaylistResult<{ name: string }> {
  const playlists = getGuildPlaylists(guildId);
  const key = normalizePlaylistKey(name);
  const playlist = playlists.get(key);
  if (playlist == null) {
    return { ok: false, message: `Playlist "${name}" does not exist` };
  }
  playlists.delete(key);
  return { ok: true, value: { name: playlist.name } };
}

export function renamePlaylist(
  guildId: string,
  name: string,
  newName: string,
): PlaylistResult<InMemoryPlaylist> {
  const playlists = getGuildPlaylists(guildId);
  const key = normalizePlaylistKey(name);
  const playlist = playlists.get(key);
  if (playlist == null) {
    return { ok: false, message: `Playlist "${name}" does not exist` };
  }
  const trimmedNewName = newName.trim();
  if (trimmedNewName.length === 0) {
    return { ok: false, message: "new playlist name is required" };
  }
  const newKey = normalizePlaylistKey(trimmedNewName);
  if (newKey !== key && playlists.has(newKey)) {
    return {
      ok: false,
      message: `Playlist "${trimmedNewName}" already exists`,
    };
  }
  playlists.delete(key);
  const updated = {
    ...playlist,
    name: trimmedNewName,
    updatedAt: new Date(),
  };
  playlists.set(newKey, updated);
  return { ok: true, value: clonePlaylist(updated) };
}

export function listPlaylists(
  guildId: string,
): { name: string; trackCount: number }[] {
  return [...getGuildPlaylists(guildId).values()].map((playlist) => ({
    name: playlist.name,
    trackCount: playlist.tracks.length,
  }));
}

export function getPlaylist(
  guildId: string,
  name: string,
): PlaylistResult<InMemoryPlaylist> {
  const playlist = getGuildPlaylists(guildId).get(normalizePlaylistKey(name));
  if (playlist == null) {
    return { ok: false, message: `Playlist "${name}" does not exist` };
  }
  return { ok: true, value: clonePlaylist(playlist) };
}

export function addTrackToPlaylist(
  guildId: string,
  name: string,
  track: MusicTrackInfo,
): PlaylistResult<InMemoryPlaylist> {
  const playlists = getGuildPlaylists(guildId);
  const key = normalizePlaylistKey(name);
  const playlist = playlists.get(key);
  if (playlist == null) {
    return { ok: false, message: `Playlist "${name}" does not exist` };
  }
  playlist.tracks.push({ ...track });
  playlist.updatedAt = new Date();
  return { ok: true, value: clonePlaylist(playlist) };
}

export function replacePlaylistTracks(
  guildId: string,
  name: string,
  tracks: MusicTrackInfo[],
): PlaylistResult<InMemoryPlaylist> {
  const playlists = getGuildPlaylists(guildId);
  const key = normalizePlaylistKey(name);
  const playlist = playlists.get(key);
  if (playlist == null) {
    return { ok: false, message: `Playlist "${name}" does not exist` };
  }
  playlist.tracks = tracks.map((track) => ({ ...track }));
  playlist.updatedAt = new Date();
  return { ok: true, value: clonePlaylist(playlist) };
}

export function removeTrackFromPlaylist(
  guildId: string,
  name: string,
  position: number,
): PlaylistResult<InMemoryPlaylist> {
  const playlists = getGuildPlaylists(guildId);
  const key = normalizePlaylistKey(name);
  const playlist = playlists.get(key);
  if (playlist == null) {
    return { ok: false, message: `Playlist "${name}" does not exist` };
  }
  const index = position - 1;
  if (index < 0 || index >= playlist.tracks.length) {
    return { ok: false, message: "Invalid playlist position" };
  }
  playlist.tracks.splice(index, 1);
  playlist.updatedAt = new Date();
  return { ok: true, value: clonePlaylist(playlist) };
}

export function movePlaylistTrack(
  guildId: string,
  name: string,
  fromPosition: number,
  toPosition: number,
): PlaylistResult<InMemoryPlaylist> {
  const playlists = getGuildPlaylists(guildId);
  const key = normalizePlaylistKey(name);
  const playlist = playlists.get(key);
  if (playlist == null) {
    return { ok: false, message: `Playlist "${name}" does not exist` };
  }
  const fromIndex = fromPosition - 1;
  const toIndex = toPosition - 1;
  if (
    fromIndex < 0 ||
    fromIndex >= playlist.tracks.length ||
    toIndex < 0 ||
    toIndex >= playlist.tracks.length
  ) {
    return { ok: false, message: "Invalid playlist position" };
  }
  const track = playlist.tracks[fromIndex];
  if (track == null) {
    return { ok: false, message: "Invalid playlist position" };
  }
  playlist.tracks.splice(fromIndex, 1);
  playlist.tracks.splice(toIndex, 0, track);
  playlist.updatedAt = new Date();
  return { ok: true, value: clonePlaylist(playlist) };
}

export function clearPlaylist(
  guildId: string,
  name: string,
): PlaylistResult<InMemoryPlaylist> {
  return replacePlaylistTracks(guildId, name, []);
}

export function shuffledTracks(tracks: MusicTrackInfo[]): MusicTrackInfo[] {
  const shuffled = tracks.map((track) => ({ ...track }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (current == null || replacement == null) {
      continue;
    }
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}
