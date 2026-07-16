import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  findBestMatch,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";

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
 * Turn a `/stream play` query into a concrete {@link Source}: prefer a local library match, then an
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

const CHARACTER_BUDGET = 200;

/**
 * Turn a synchronous pre-validation failure (yt-dlp threw while resolving a `/stream play` url/
 * search source) into a specific, user-facing reply. Best-effort — matches yt-dlp's own stderr
 * phrasing, which can drift across versions, so a generic fallback bucket always catches the rest.
 */
export function classifyPlayError(
  error: unknown,
  sourceKind: Source["kind"],
): string {
  const message = getErrorMessage(error);
  if (message.includes("Unsupported URL")) {
    return "That site isn't supported. Try `/stream sources` to check, or use a different link.";
  }
  if (
    message.includes("Video unavailable") ||
    message.includes("Private video") ||
    message.includes("This video is unavailable")
  ) {
    return "That video is unavailable, private, or has been removed.";
  }
  if (
    sourceKind === "search" &&
    /no (?:videos?|results?) found/iu.test(message)
  ) {
    return "No results found for that search.";
  }
  const trimmed =
    message.length > CHARACTER_BUDGET
      ? `${message.slice(0, CHARACTER_BUDGET)}…`
      : message;
  return `Couldn't queue that: ${trimmed}`;
}
