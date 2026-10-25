import { z } from "zod";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { SportsEventSchema, type SportsEvent } from "./types.ts";
import { isSportsArtworkUrl } from "./artwork.ts";

export const LolLeagueSchema = z.enum([
  "lck",
  "worlds",
  "msi",
  "first_stand",
  "lpl",
  "lec",
  "lcs",
]);
export const LOL_LEAGUES = {
  lck: "98767991310872058",
  worlds: "98767975604431411",
  msi: "98767991325878492",
  first_stand: "113464388705111224",
  lpl: "98767991314006698",
  lec: "98767991302996019",
  lcs: "98767991299243165",
} satisfies Record<z.infer<typeof LolLeagueSchema>, string>;

// The public site's persisted manifest ID, not the codegen document hash.
// Contract fixtures deliberately pin the request as well as its response.
export const LOL_EVENTS_QUERY =
  "e4da9fd0ab89ecdb783912d74799688d1f52f1edc9b87497d3409c74d9b4291a";
const StreamSchema = z.object({
  id: z.string(),
  provider: z.string(),
  parameter: z.string(),
  mediaLocale: z.object({ locale: z.string() }),
  countries: z.array(z.string()),
});
export const LolMatchSchema = z.object({
  id: z.string().regex(/^\d+$/),
  type: z.literal("match"),
  startTime: z.iso.datetime(),
  state: z.enum(["unstarted", "inProgress", "completed", "cancelled"]),
  league: z.object({
    slug: LolLeagueSchema,
    name: z.string(),
    image: z.url().nullable().optional(),
  }),
  matchTeams: z
    .array(
      z.object({
        name: z.string(),
        code: z.string(),
        image: z.url().nullable().optional(),
      }),
    )
    .length(2),
  match: z.object({
    strategy: z.object({
      type: z.literal("bestOf"),
      count: z.number().int().positive(),
    }),
  }),
  streams: z.array(StreamSchema),
});
export type LolMatch = z.infer<typeof LolMatchSchema>;
const PageSchema = z.object({
  data: z.object({
    esports: z.object({
      events: z.array(LolMatchSchema),
      pages: z.object({
        newer: z.string().nullable(),
        older: z.string().nullable(),
      }),
    }),
  }),
});

export function lolBroadcasts(match: LolMatch): string[] {
  return match.streams
    .filter(
      (s) =>
        /^en(?:-|$)/i.test(s.mediaLocale.locale) && s.countries.length === 0,
    )
    .toSorted(
      (a, b) =>
        Number(b.provider === "youtube") - Number(a.provider === "youtube"),
    )
    .flatMap((s) => {
      if (s.provider === "youtube" && /^[\w-]{11}$/.test(s.parameter))
        return [`https://www.youtube.com/watch?v=${s.parameter}`];
      return s.provider === "twitch" && /^\w+$/.test(s.parameter)
        ? [`https://www.twitch.tv/${s.parameter}`]
        : [];
    });
}

export function lolSportsEvent(match: LolMatch): SportsEvent {
  if (match.state !== "unstarted" && match.state !== "inProgress")
    throw new Error("A finished LoL match is not a playable sports event");
  return SportsEventSchema.parse({
    id: `lolesports:${match.id}`,
    provider: "lolesports",
    title: `${match.league.name}: ${match.matchTeams.map((t) => (t.name === t.code ? t.name : `${t.name} (${t.code})`)).join(" vs ")} · Bo${String(match.match.strategy.count)}`,
    status: match.state === "inProgress" ? "live" : "scheduled",
    startsAt: match.startTime,
    pageUrl: `https://lolesports.com/en-US/leagues/${match.league.slug}#${match.id}`,
    lol: {
      eventId: match.id,
      league: match.league.slug,
      bestOf: match.match.strategy.count,
    },
    artwork: lolArtwork(match),
  });
}

function officialLogo(value: string | null | undefined) {
  if (value === undefined || value === null) return;
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "https:";
  return isSportsArtworkUrl(url.href) ? url.href : undefined;
}

function lolArtwork(match: LolMatch) {
  const broadcasts = lolBroadcasts(match);
  const youtube = broadcasts.find(
    (url) => new URL(url).hostname === "www.youtube.com",
  );
  const twitch = broadcasts.find(
    (url) => new URL(url).hostname === "www.twitch.tv",
  );
  const youtubeId =
    youtube === undefined ? null : new URL(youtube).searchParams.get("v");
  const thumbnailUrl =
    youtubeId === null
      ? twitch === undefined
        ? undefined
        : `https://static-cdn.jtvnw.net/previews-ttv/live_user_${new URL(twitch).pathname.slice(1)}-440x248.jpg`
      : `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  const leagueLogo = officialLogo(match.league.image);
  return {
    ...(thumbnailUrl !== undefined && match.state === "inProgress"
      ? { thumbnailUrl }
      : {}),
    teams: match.matchTeams.map((team) => {
      const logoUrl = officialLogo(team.image);
      return { name: team.name, ...(logoUrl === undefined ? {} : { logoUrl }) };
    }),
    league: {
      name: match.league.name,
      ...(leagueLogo === undefined ? {} : { logoUrl: leagueLogo }),
    },
  };
}

/** Public, credential-free LoL Esports reads. No browser execution or copied API key. */
export class LolEsportsClient {
  constructor(
    private readonly request: (
      input: URL,
      init: RequestInit,
    ) => Promise<Response> = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async matches(
    signal: AbortSignal,
    options: {
      league?: string;
      from: string;
      to: string;
      states?: readonly string[];
    },
  ): Promise<LolMatch[]> {
    const leagues =
      options.league === undefined || options.league === ""
        ? Object.values(LOL_LEAGUES)
        : [LOL_LEAGUES[LolLeagueSchema.parse(options.league)]];
    const found = new Map<string, LolMatch>();
    const visited = new Set<string>();
    let pageToken: string | null = null;
    do {
      signal.throwIfAborted();
      const url = new URL("https://lolesports.com/api/gql");
      url.searchParams.set("operationName", "homeEvents");
      url.searchParams.set(
        "variables",
        JSON.stringify({
          hl: "en-US",
          sport: "lol",
          leagues,
          eventType: "match",
          eventDateStart: options.from,
          eventDateEnd: options.to,
          pageSize: 300,
          ...(options.states === undefined
            ? {}
            : { eventState: options.states }),
          ...(pageToken === null ? {} : { pageToken }),
        }),
      );
      url.searchParams.set(
        "extensions",
        JSON.stringify({
          persistedQuery: { version: 1, sha256Hash: LOL_EVENTS_QUERY },
        }),
      );
      const response = await this.request(url, {
        signal,
        headers: {
          "content-type": "application/json",
          "x-apollo-operation-name": "homeEvents",
          "apollographql-client-name": "Esports Web",
          "apollographql-client-version": "2026.10.25",
        },
      });
      if (!response.ok)
        throw new PlaybackCommandBoundaryError(
          "LoL Esports schedules are temporarily unavailable.",
        );
      const page = PageSchema.parse(await response.json()).data.esports;
      for (const match of page.events) found.set(match.id, match);
      pageToken = page.pages.newer;
      if (pageToken !== null) {
        if (visited.has(pageToken))
          throw new Error("LoL Esports returned a repeated schedule cursor");
        visited.add(pageToken);
      }
    } while (pageToken !== null);
    return [...found.values()].toSorted(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id),
    );
  }

  async list(
    signal: AbortSignal,
    options: {
      league?: string;
      range?: "today" | "week";
      timeZone?: string;
    } = {},
  ): Promise<SportsEvent[]> {
    const day = 86_400_000;
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: options.timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const firstDay = localDate.format(this.now());
    const lastDay = new Date(firstDay + "T00:00:00Z");
    lastDay.setUTCDate(
      lastDay.getUTCDate() + (options.range === "week" ? 7 : 1),
    );
    const end = lastDay.toISOString().slice(0, 10);
    // Fetch a margin around local dates, then filter by calendar date. DST days
    // are not necessarily 24 hours, and an ongoing series can cross midnight.
    const from = new Date(this.now() - 2 * day);
    const to = new Date(this.now() + 8 * day);
    const matches = await this.matches(signal, {
      ...options,
      from: from.toISOString(),
      to: to.toISOString(),
      states: ["inProgress", "unstarted"],
    });
    return matches
      .filter(
        (m) =>
          m.state === "inProgress" ||
          (m.state === "unstarted" &&
            localDate.format(Date.parse(m.startTime)) >= firstDay &&
            localDate.format(Date.parse(m.startTime)) < end),
      )
      .map((m) => lolSportsEvent(m));
  }

  async find(
    event: SportsEvent,
    signal: AbortSignal,
  ): Promise<LolMatch | undefined> {
    if (event.lol === undefined || event.startsAt === null)
      throw new Error("LoL event identity is missing");
    const from = new Date(event.startsAt);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(
      Math.max(this.now(), Date.parse(event.startsAt)) + 8 * 86_400_000,
    );
    const matches = await this.matches(signal, {
      league: event.lol.league,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return matches.find((m) => m.id === event.lol?.eventId);
  }
}
