import type { z } from "zod";
import type { HistoryPageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { HistoryProviderSchema } from "@shepherdjerred/streambot/history/provider.ts";
import type { RowAction } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";

export type HistoryProvider = z.infer<typeof HistoryProviderSchema>;
export type HistoryEntry = z.infer<typeof HistoryPageSchema>["items"][number];

/** What the viewer sees for a provider; the filter offers the same names. */
export const PROVIDER_LABELS: Readonly<Record<HistoryProvider, string>> = {
  local: "Library",
  youtube: "YouTube",
  url: "Link",
  streameast: "Live sports",
  tvsportslive: "Live sports",
  lolesports: "Live sports",
};

/** One entry per name: the three sports providers read the same to a viewer. */
export const PROVIDER_FILTERS: readonly {
  value: HistoryProvider | "";
  label: string;
}[] = [
  { value: "", label: "All sources" },
  { value: "local", label: "Library" },
  { value: "youtube", label: "YouTube" },
  { value: "url", label: "Links" },
  { value: "streameast", label: "StreamEast" },
  { value: "tvsportslive", label: "TVSportsLive" },
  { value: "lolesports", label: "LoL Esports" },
];

/**
 * The buttons a replay offers. This repeats the server's rule (`historyActions` in
 * `web/server/search/rows.ts`) because `/api/history` does not send actions: library and live
 * items only play as video; YouTube and links offer both, the one they were recorded as first.
 * The response does not say whether an item was music (the server sends `mediaKind: null`), so
 * today every YouTube or link replay leads with Watch.
 */
export function historyActions(input: {
  provider: HistoryProvider;
  music: boolean;
  replayAvailable: boolean;
  listenAllowed: boolean;
}): RowAction[] {
  if (!input.replayAvailable) return [];
  if (input.provider !== "youtube" && input.provider !== "url")
    return ["watch"];
  if (!input.listenAllowed) return ["watch"];
  return input.music ? ["listen", "watch"] : ["watch", "listen"];
}

const WHEN = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A past play as a row: when and by whom beneath the title, replayable only when it still is. */
export function historyItem(
  entry: HistoryEntry,
  listenAllowed: boolean,
): MediaItem {
  const requester = entry.requester?.name;
  const detail = [
    PROVIDER_LABELS[entry.provider],
    WHEN.format(new Date(entry.playedAt)),
    requester,
    entry.replayAvailable ? undefined : "Can't be replayed",
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
  return {
    key: "history:" + entry.id,
    kind: "history",
    title: entry.title,
    subtitle: detail,
    ...(entry.durationSeconds === null
      ? {}
      : { durationSeconds: entry.durationSeconds }),
    ...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl }),
    ...(entry.sportsArtwork === undefined
      ? {}
      : { sportsArtwork: entry.sportsArtwork }),
    actions: historyActions({
      provider: entry.provider,
      music: entry.music === true || entry.mediaKind === "music",
      replayAvailable: entry.replayAvailable,
      listenAllowed,
    }),
    selection: entry.replayAvailable ? { kind: "history", id: entry.id } : null,
  };
}
