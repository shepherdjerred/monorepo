export const BOOKMARKS_KEY = "bsc.bookmarks.v2";
export const WATCH_STATUS_KEY = "bsc.watch-status.v2";
export const QUERY_CACHE_KEY = "bsc.query-cache.v1";

/** Hidden manual flag predating the rewrite; the key is intentionally kept. */
export const DOWNLOAD_FLAG_KEY = "download";

export const LEGACY_KEYS = {
  bookmarks: "bookmarks",
  watchStatus: "watchStatus",
  content: "content",
  contentTimestamp: "content-timestamp",
} as const;

export function legacyBackupKey(name: "bookmarks" | "watch-status"): string {
  return `bsc.${name}.legacy-backup`;
}
