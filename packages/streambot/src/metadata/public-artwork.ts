import {
  isSportsArtworkUrl,
  SPORTS_ARTWORK_HOST,
  LOL_ARTWORK_HOST,
  isSportsThumbnailUrl,
} from "@shepherdjerred/streambot/sports/artwork.ts";
import {
  isSpotifyArtworkUrl,
  SPOTIFY_ARTWORK_HOSTS,
  YOUTUBE_MUSIC_ARTWORK_HOSTS,
} from "@shepherdjerred/streambot/music/artwork.ts";

export const ARTWORK_HOSTS: readonly string[] = [
  ...new Set([
    "image.tmdb.org",
    "i.ytimg.com",
    "img.youtube.com",
    // YouTube Music covers and artist photos; the CSP `img-src` is built from this list.
    ...YOUTUBE_MUSIC_ARTWORK_HOSTS,
  ]),
  ...SPOTIFY_ARTWORK_HOSTS,
  SPORTS_ARTWORK_HOST,
  LOL_ARTWORK_HOST,
  "static-cdn.jtvnw.net",
];

/** Only public image CDNs supported by our metadata producers may reach the browser. */
export function isRemoteArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      ARTWORK_HOSTS.includes(url.hostname) &&
      (!SPOTIFY_ARTWORK_HOSTS.includes(url.hostname) ||
        isSpotifyArtworkUrl(value)) &&
      (![SPORTS_ARTWORK_HOST, LOL_ARTWORK_HOST].includes(url.hostname) ||
        isSportsArtworkUrl(value)) &&
      (url.hostname !== "static-cdn.jtvnw.net" || isSportsThumbnailUrl(value))
    );
  } catch {
    return false;
  }
}
