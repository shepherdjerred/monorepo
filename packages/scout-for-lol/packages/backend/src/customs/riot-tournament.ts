import { z } from "zod";
import type {
  CustomGameSnapshot,
  CustomMap,
  CustomPickMode,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";

const TOURNAMENT_API_BASE =
  "https://americas.api.riotgames.com/lol/tournament/v5";
const TOURNAMENT_REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const TOURNAMENT_RETRY_ATTEMPTS = 3;
const TOURNAMENT_RETRY_DELAY_MILLISECONDS = 250;

function isPostRequest(init: RequestInit): boolean {
  return init.method?.toUpperCase() === "POST";
}

function isAmbiguousPostResponse(init: RequestInit, status: number): boolean {
  return isPostRequest(init) && status >= 500 && status <= 599;
}

export type TournamentFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const RawTournamentIdSchema = z.number().int().positive();
const RawTournamentCodesSchema = z.array(z.string().min(1)).min(1);
const RawTournamentGamesSchema = z.array(
  z.object({
    startTime: z.number().int(),
    winningTeam: z.array(z.object({ puuid: z.string().min(1) })).min(1),
    losingTeam: z.array(z.object({ puuid: z.string().min(1) })).min(1),
    shortCode: z.string().min(1),
    metaData: z.string().nullable().optional(),
    gameId: z.number().int().positive(),
    gameName: z.string(),
    gameType: z.string(),
    gameMap: z.number().int(),
    gameMode: z.string(),
    region: z.string(),
  }),
);
export type RawTournamentGame = z.infer<
  typeof RawTournamentGamesSchema
>[number];

export const RawTournamentCallbackSchema = z.object({
  startTime: z.number().int(),
  shortCode: z.string().min(1),
  metaData: z.string().min(1),
  gameId: z.number().int().positive(),
  gameName: z.string(),
  gameType: z.string(),
  gameMap: z.number().int(),
  gameMode: z.string(),
  region: z.literal("NA1"),
});

export const TournamentMetadataSchema = z.object({
  nightId: z.uuid(),
  gameId: z.uuid(),
  callbackSecret: z.string().min(32),
});

type RiotTournamentApiErrorOptions = ErrorOptions & {
  ambiguous?: boolean;
};

export class RiotTournamentApiError extends Error {
  readonly ambiguous: boolean;

  constructor(message: string, options?: RiotTournamentApiErrorOptions) {
    super(message, options);
    this.name = "RiotTournamentApiError";
    this.ambiguous = options?.ambiguous === true;
  }
}

async function riotRequest(
  path: string,
  init: RequestInit,
  fetcher: TournamentFetch,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Riot-Token", configuration.riotApiToken);
  const canRetry = init.method?.toUpperCase() !== "POST";
  for (let attempt = 0; attempt <= TOURNAMENT_RETRY_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(`${TOURNAMENT_API_BASE}${path}`, {
        ...init,
        headers,
        signal:
          init.signal ??
          AbortSignal.timeout(TOURNAMENT_REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch (error) {
      if (
        !canRetry ||
        init.signal?.aborted === true ||
        attempt >= TOURNAMENT_RETRY_ATTEMPTS
      ) {
        throw new RiotTournamentApiError(
          "Riot Tournament-V5 request could not be completed",
          { cause: error, ambiguous: isPostRequest(init) },
        );
      }
      const delay = TOURNAMENT_RETRY_DELAY_MILLISECONDS * 2 ** attempt;
      await Bun.sleep(delay);
      continue;
    }
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw new RiotTournamentApiError(
        "Riot Tournament-V5 response could not be read",
        { cause: error, ambiguous: isPostRequest(init) },
      );
    }
    const retryable =
      response.status === 429 ||
      (response.status >= 500 && response.status <= 599);
    if (
      canRetry &&
      retryable &&
      !response.ok &&
      attempt < TOURNAMENT_RETRY_ATTEMPTS
    ) {
      const retryAfter = Number.parseInt(
        response.headers.get("retry-after") ?? "",
        10,
      );
      const delay = Number.isFinite(retryAfter)
        ? Math.min(retryAfter * 1000, 30_000)
        : TOURNAMENT_RETRY_DELAY_MILLISECONDS * 2 ** attempt;
      await Bun.sleep(delay);
      continue;
    }
    if (!response.ok) {
      throw new RiotTournamentApiError(
        `Riot Tournament-V5 request failed (${response.status.toString()}): ${body.slice(0, 300)}`,
        {
          ambiguous: isAmbiguousPostResponse(init, response.status),
        },
      );
    }
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new RiotTournamentApiError(
        "Riot Tournament-V5 returned invalid JSON",
        {
          cause: error,
          ambiguous: isPostRequest(init),
        },
      );
    }
  }
  throw new Error("Riot Tournament-V5 retry loop completed without a result");
}

function providerId(): number {
  const raw = configuration.customs?.tournamentProviderId;
  if (raw === undefined)
    throw new Error("Scout Customs Tournament provider is not configured");
  return z.coerce.number().int().positive().parse(raw);
}

export async function createNightTournament(
  nightId: string,
  fetcher: TournamentFetch = fetch,
): Promise<string> {
  let response: unknown;
  try {
    response = await riotRequest(
      "/tournaments",
      {
        method: "POST",
        body: JSON.stringify({
          providerId: providerId(),
          name: `Scout Customs ${nightId}`,
        }),
      },
      fetcher,
    );
    return RawTournamentIdSchema.parse(response).toString();
  } catch (error) {
    if (error instanceof RiotTournamentApiError) throw error;
    throw new RiotTournamentApiError(
      "Riot Tournament-V5 returned an invalid tournament response",
      { cause: error, ambiguous: true },
    );
  }
}

export async function createGameTournamentCode(params: {
  tournamentId: string;
  nightId: string;
  game: CustomGameSnapshot;
  fetcher?: TournamentFetch | undefined;
}): Promise<string> {
  const tournamentId = z.coerce
    .number()
    .int()
    .positive()
    .parse(params.tournamentId);
  if (params.game.participants.length !== 10)
    throw new Error("Tournament codes require 10 players");
  const response = await riotRequest(
    `/codes?tournamentId=${tournamentId.toString()}&count=1`,
    {
      method: "POST",
      body: JSON.stringify({
        allowedParticipants: params.game.participants.map(
          (participant) => participant.puuid,
        ),
        metadata: JSON.stringify({
          nightId: params.nightId,
          gameId: params.game.id,
          callbackSecret: configuration.customs?.callbackSecret,
        }),
        teamSize: 5,
        pickType: riotPickType(params.game.pickMode),
        mapType: riotMapType(params.game.map),
        spectatorType: "ALL",
        enoughPlayers: true,
      }),
    },
    params.fetcher ?? fetch,
  );
  let codes: string[];
  try {
    codes = RawTournamentCodesSchema.parse(response);
  } catch (error) {
    throw new RiotTournamentApiError(
      "Riot Tournament-V5 returned an invalid Tournament code response",
      { cause: error, ambiguous: true },
    );
  }
  const code = codes[0];
  if (code === undefined) throw new Error("Riot returned no Tournament code");
  return code;
}

export async function getTournamentGames(
  code: string,
  fetcher: TournamentFetch = fetch,
): Promise<RawTournamentGame[]> {
  try {
    return RawTournamentGamesSchema.parse(
      await riotRequest(
        `/games/by-code/${encodeURIComponent(code)}`,
        { method: "GET" },
        fetcher,
      ),
    );
  } catch (error) {
    if (error instanceof RiotTournamentApiError) throw error;
    throw new RiotTournamentApiError(
      "Riot Tournament-V5 returned an invalid games payload",
      { cause: error },
    );
  }
}

export function riotMapType(
  map: CustomMap,
): "SUMMONERS_RIFT" | "HOWLING_ABYSS" {
  return map;
}

export function riotPickType(
  pickMode: CustomPickMode,
): "TOURNAMENT_DRAFT" | "BLIND_PICK" | "DRAFT_MODE" | "ALL_RANDOM" {
  return pickMode;
}
