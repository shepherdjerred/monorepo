import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  findBestMatch,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";

/** True for an `http(s)://` URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Turn a `/play` query into a concrete {@link Source}: prefer a local library match, then an
 * explicit URL, otherwise treat it as a search query resolved by yt-dlp at play time. Pure.
 */
export function resolvePlayQuery(
  query: string,
  entries: readonly LibraryEntry[],
): Source {
  const match = findBestMatch(entries, query);
  if (match !== null) {
    return { kind: "file", path: match.path, title: match.title };
  }
  if (isHttpUrl(query)) {
    return { kind: "url", url: query };
  }
  return { kind: "search", query };
}
