import type { YtdlpSearchResult } from "@shepherdjerred/streambot/sources/youtube-search-result.ts";
import type { MusicMatch, MusicTrack } from "./contracts.ts";

function words(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(
      /\b(?:official|audio|video|lyrics?|visualizer|hd|hq|vevo|topic)\b/gu,
      " ",
    )
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replaceAll(/\s+/gu, " ");
}
const VARIANTS =
  /\b(?:live|remix|cover|karaoke|instrumental|acoustic|sped|slowed|nightcore|clean|explicit|remaster(?:ed)?)\b/giu;
function variants(value: string): string {
  return [...new Set(value.toLowerCase().match(VARIANTS))].sort().join(" ");
}
/** Catalog music uses recording/version matching, independently of free-form video discovery. */
export function rankMusicMatches(
  track: MusicTrack,
  results: readonly YtdlpSearchResult[],
): MusicMatch[] {
  const title = words(track.title);
  return results
    .map((result, index) => {
      const text = words(result.title);
      const channel = words(result.channel ?? "");
      const artistChannel = track.artists.some((artist) => {
        const name = words(artist);
        return name.length > 0 && channel.includes(name);
      });
      const titleMatches = text.includes(title);
      const artistMatches = track.artists.some((artist) => {
        const name = words(artist);
        return (
          name.length > 0 && (text.includes(name) || channel.includes(name))
        );
      });
      const versionMatches =
        variants(track.title + " " + (track.version ?? "")) ===
        variants(result.title);
      const durationMatches =
        track.durationSeconds === undefined ||
        (result.durationSeconds !== undefined &&
          Math.abs(track.durationSeconds - result.durationSeconds) <=
            Math.max(10, track.durationSeconds * 0.05));
      const confident =
        titleMatches && artistMatches && versionMatches && durationMatches;
      const official = /\b(?:official|topic|vevo)\b/iu.test(
        result.title + " " + (result.channel ?? ""),
      );
      return {
        match: {
          url: result.url,
          title: result.title,
          confident,
          ...(result.channel === undefined ? {} : { channel: result.channel }),
          ...(result.durationSeconds === undefined
            ? {}
            : { durationSeconds: result.durationSeconds }),
        },
        score:
          Number(confident) * 100 +
          Number(titleMatches) * 20 +
          Number(artistMatches) * 20 +
          Number(versionMatches) * 10 +
          Number(official) * 3 +
          Number(artistChannel) * 15 -
          index / 100,
      };
    })
    .toSorted((a, b) => b.score - a.score)
    .map(({ match }) => match);
}

export class MusicMatchError extends Error {
  constructor(readonly matches: readonly MusicMatch[]) {
    super(
      matches.length === 0
        ? "No YouTube recording was found for this song."
        : "This song needs a YouTube match. Open Music in Streambot and choose a video.",
    );
    this.name = "MusicMatchError";
  }
}
