import { useLocation, useSearchParams } from "react-router";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";

export const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/music": "Music",
  "/playlists": "Playlists",
  "/plex": "Plex",
  "/search": "Search & links",
  "/sports": "Live sports",
  "/history": "History",
};

export function useRouteState() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  function values(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    return next;
  }
  return {
    params,
    update: (changes: Record<string, string>, replace = false) => {
      setParams(values(changes), { replace });
    },
    href: (changes: Record<string, string>) =>
      pathname + "?" + values(changes).toString(),
  };
}

export function pageOffset(value: string | null): number {
  return value !== null && /^\d{1,7}$/u.test(value) ? Number(value) : 0;
}

export function selectedGuildId(
  guilds: readonly { id: string }[],
  requested: string | null,
): string {
  return (
    guilds.find((guild) => guild.id === requested)?.id ?? guilds[0]?.id ?? ""
  );
}

export function resolveChannelDeepLink(
  requested: string | null,
  snapshot: Pick<
    WebSnapshot,
    | "channel"
    | "playbackChannel"
    | "selectedPlaybackChannel"
    | "selectionMode"
    | "playbackChannels"
  >,
): number | null {
  if (
    requested === null ||
    snapshot.channel === null ||
    snapshot.playbackChannel === null ||
    !/^\d+$/u.test(requested)
  )
    return null;
  const parsed = Number(requested);
  if (parsed < 1 || parsed > snapshot.playbackChannels.length) return null;
  return snapshot.selectionMode === "manual" &&
    snapshot.selectedPlaybackChannel === parsed
    ? null
    : parsed;
}
