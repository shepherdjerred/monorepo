/** Public Spotify covers only; arbitrary URLs must never become persisted artwork. */
export const SPOTIFY_ARTWORK_HOSTS: readonly string[] = [
  "i.scdn.co",
  "image-cdn-ak.spotifycdn.com",
];

export function isSpotifyArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      SPOTIFY_ARTWORK_HOSTS.includes(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      /^\/image\/[a-zA-Z0-9]+$/u.test(url.pathname) &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

/** Thumbnail hosts a YouTube Music writer may persist; exact hostnames only. */
export const YOUTUBE_MUSIC_ARTWORK_HOSTS: readonly string[] = [
  "i.ytimg.com",
  "lh3.googleusercontent.com",
  "yt3.googleusercontent.com",
  "yt3.ggpht.com",
];

export function isYouTubeMusicArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      YOUTUBE_MUSIC_ARTWORK_HOSTS.includes(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

export function musicArtworkUrl(
  music:
    | {
        provider?: string | undefined;
        artworkId?: string | undefined;
        artworkUrl?: string | undefined;
      }
    | undefined,
  guildId?: string,
): string | undefined {
  if (music?.artworkUrl !== undefined) return music.artworkUrl;
  // Cover Art Archive keys are MusicBrainz release groups only.
  if (music?.provider === "youtube-music") return;
  if (music?.artworkId === undefined) return;
  return guildId === undefined
    ? "https://coverartarchive.org/release-group/" +
        music.artworkId +
        "/front-250"
    : "/api/music/artwork?" +
        new URLSearchParams({ guildId, id: music.artworkId }).toString();
}
