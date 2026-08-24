import {
  type AccountRegionalRoute,
  type RegionalRoute,
  type PlatformRoute,
  type LeaguePuuid,
  type MatchId,
  type RiotGameName,
  type RiotTagLine,
  type EpochSeconds,
  type RawAccount,
  RawAccountSchema,
  MatchIdSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  RateLimiter,
  type RateLimitedRequestOptions,
  type RateLimiterOptions,
} from "./rate-limiter.ts";

export type MatchListParams = {
  count?: number | undefined;
  start?: number | undefined;
  startTime?: EpochSeconds | number | undefined;
  endTime?: EpochSeconds | number | undefined;
  queue?: number | undefined;
  type?: string | undefined;
};

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RiotClientOptions = RateLimiterOptions & {
  apiKey: string;
  fetchFn?: FetchFunction | undefined;
};

const MatchIdListSchema = z.array(MatchIdSchema);

export class RiotClient {
  private readonly apiKey: string;
  private readonly rateLimiter: RateLimiter;
  private readonly fetchFn: FetchFunction;

  constructor(options: RiotClientOptions) {
    this.apiKey = options.apiKey;
    this.rateLimiter = new RateLimiter({
      concurrency: options.concurrency,
      maxRetries: options.maxRetries,
    });
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async fetchJson(
    url: string,
    requestOptions: RateLimitedRequestOptions = {},
  ): Promise<unknown> {
    const response = await this.rateLimiter.execute(
      url,
      () =>
        this.fetchFn(url, {
          headers: {
            "X-Riot-Token": this.apiKey,
            Accept: "application/json",
          },
        }),
      requestOptions,
    );
    return response.json();
  }

  public readonly account = {
    getByPuuid: async (
      puuid: LeaguePuuid,
      regionalRoute: AccountRegionalRoute | RegionalRoute = "AMERICAS",
    ): Promise<RawAccount> => {
      const region = regionalRoute === "SEA" ? "ASIA" : regionalRoute;
      const url = `https://${region.toLowerCase()}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`;
      const data = await this.fetchJson(url);
      return RawAccountSchema.parse(data);
    },

    getByRiotId: async (
      gameName: RiotGameName | string,
      tagLine: RiotTagLine | string,
      regionalRoute: AccountRegionalRoute | RegionalRoute = "AMERICAS",
    ): Promise<RawAccount> => {
      const region = regionalRoute === "SEA" ? "ASIA" : regionalRoute;
      const url = `https://${region.toLowerCase()}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
      const data = await this.fetchJson(url);
      return RawAccountSchema.parse(data);
    },
  };

  public readonly match = {
    list: async (
      puuid: LeaguePuuid,
      regionalRoute: RegionalRoute,
      params: MatchListParams = {},
      requestOptions: RateLimitedRequestOptions = {},
    ): Promise<MatchId[]> => {
      const searchParams = new URLSearchParams();
      if (params.count !== undefined)
        searchParams.set("count", params.count.toString());
      if (params.start !== undefined)
        searchParams.set("start", params.start.toString());
      if (params.startTime !== undefined)
        searchParams.set("startTime", params.startTime.toString());
      if (params.endTime !== undefined)
        searchParams.set("endTime", params.endTime.toString());
      if (params.queue !== undefined)
        searchParams.set("queue", params.queue.toString());
      if (params.type !== undefined) searchParams.set("type", params.type);

      const qs = searchParams.toString();
      const queryString = qs.length > 0 ? `?${qs}` : "";
      const url = `https://${regionalRoute.toLowerCase()}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids${queryString}`;
      const data = await this.fetchJson(url, requestOptions);
      return MatchIdListSchema.parse(data);
    },

    get: async (
      matchId: MatchId | string,
      regionalRoute: RegionalRoute,
      requestOptions: RateLimitedRequestOptions = {},
    ): Promise<unknown> => {
      const url = `https://${regionalRoute.toLowerCase()}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
      return this.fetchJson(url, requestOptions);
    },

    timeline: async (
      matchId: MatchId | string,
      regionalRoute: RegionalRoute,
    ): Promise<unknown> => {
      const url = `https://${regionalRoute.toLowerCase()}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`;
      return this.fetchJson(url);
    },
  };

  public readonly league = {
    byPuuid: async (
      puuid: LeaguePuuid,
      platform: PlatformRoute,
      requestOptions: RateLimitedRequestOptions = {},
    ): Promise<unknown> => {
      const url = `https://${platform.toLowerCase()}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
      return this.fetchJson(url, requestOptions);
    },
  };

  public readonly spectator = {
    activeGame: async (
      puuid: LeaguePuuid,
      platform: PlatformRoute,
    ): Promise<unknown> => {
      const url = `https://${platform.toLowerCase()}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`;
      return this.fetchJson(url);
    },
  };
}
