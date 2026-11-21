import type { z } from "zod";
import {
  SportsQuerySchema,
  type SportsResultsSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { apiUrl } from "@shepherdjerred/streambot/web/client/api.ts";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";

export type Game = z.infer<typeof SportsResultsSchema>[number];
type SportsQuery = z.infer<typeof SportsQuerySchema>;
export type SportsProvider = SportsQuery["provider"];
export type SportsRange = SportsQuery["range"];

export const LEAGUES = [
  "lck",
  "worlds",
  "msi",
  "first_stand",
  "lpl",
  "lec",
  "lcs",
] as const;

const PROVIDER_NAMES: Readonly<Record<Game["provider"], string>> = {
  streameast: "StreamEast",
  tvsportslive: "TVSportsLive",
  lolesports: "LoL Esports",
};

export function providerOptions(
  lolEsports: boolean,
): readonly { value: SportsProvider; label: string }[] {
  return [
    { value: "streameast", label: PROVIDER_NAMES.streameast },
    { value: "tvsportslive", label: PROVIDER_NAMES.tvsportslive },
    ...(lolEsports
      ? [{ value: "lolesports" as const, label: PROVIDER_NAMES.lolesports }]
      : []),
    { value: "auto", label: "All providers" },
  ];
}

export function leagueLabel(league: (typeof LEAGUES)[number]): string {
  return league.toUpperCase().replaceAll("_", " ");
}

export type LiveFilters = {
  readonly query: string;
  readonly provider: SportsProvider;
  readonly league: string;
  readonly range: SportsRange;
};

/**
 * The live filters held in the address bar. A provider the server would refuse (LoL Esports where
 * it is off) reads as the default, and LoL Esports lists a week at a time unless told otherwise.
 */
export function readLiveFilters(
  params: URLSearchParams,
  lolEsports: boolean,
): LiveFilters {
  const requested = params.get("provider");
  const provider =
    providerOptions(lolEsports).find((option) => option.value === requested)
      ?.value ?? "streameast";
  const league = SportsQuerySchema.shape.league.safeParse(
    params.get("league") ?? "",
  );
  const range = params.get("range");
  return {
    query: params.get("q") ?? "",
    provider,
    league: provider === "lolesports" && league.success ? league.data : "",
    range:
      range === "today" || range === "week"
        ? range
        : provider === "lolesports"
          ? "week"
          : "today",
  };
}

/** `/api/sports` for the filters, in the viewer's own time zone. */
export function sportsUrl(
  guildId: string,
  filters: LiveFilters,
  timeZone: string,
): string {
  return apiUrl("/api/sports", {
    guildId,
    query: filters.query,
    provider: filters.provider,
    league: filters.league,
    range: filters.range,
    timeZone,
  });
}

/** A game the viewer can start now: not upcoming, and not behind a provider's paywall. */
export function canWatch(game: Game): boolean {
  return game.status !== "scheduled" && game.proOnly !== true;
}

export type GameGroups = {
  readonly live: readonly Game[];
  readonly upcoming: readonly Game[];
  /** Games whose provider gave no status; they can still be watched. */
  readonly unconfirmed: readonly Game[];
};

export function groupGames(games: readonly Game[]): GameGroups {
  return {
    live: games.filter((game) => game.status === "live"),
    upcoming: games.filter((game) => game.status === "scheduled"),
    unconfirmed: games.filter((game) => game.status === "unknown"),
  };
}

const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function gameItem(game: Game): MediaItem {
  const detail = [
    PROVIDER_NAMES[game.provider],
    game.status === "scheduled" && game.startsAt !== null
      ? DAY.format(new Date(game.startsAt))
      : undefined,
    game.proOnly === true
      ? "Only on StreamEast Pro, which Streambot can't play"
      : undefined,
  ];
  return {
    key: "live:" + game.id,
    kind: "live",
    title: game.title,
    subtitle: detail.filter((part) => part !== undefined).join(" · "),
    status: game.status,
    ...(game.startsAt === null ? {} : { startsAt: game.startsAt }),
    ...(game.sportsArtwork === undefined
      ? {}
      : { sportsArtwork: game.sportsArtwork }),
    actions: canWatch(game) ? ["watch"] : [],
    selection: { kind: "sports", id: game.id },
  };
}
