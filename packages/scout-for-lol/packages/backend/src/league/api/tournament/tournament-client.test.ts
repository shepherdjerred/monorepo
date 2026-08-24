import { describe, expect, test } from "vitest";
import { callRiotOrUndefined } from "#src/league/api/riot-call.ts";
import { extractHttpStatus } from "#src/league/api/client/errors.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";
import {
  supportsGamesByCode,
  tournamentBasePath,
} from "#src/league/api/tournament/mode.ts";
import {
  toPlatformId,
  toTournamentRegion,
} from "#src/league/api/tournament/regions.ts";
import { RawLobbyEventListSchema } from "@scout-for-lol/data/index.ts";

function riotError(status: number, statusText: string): RiotHttpError {
  return new RiotHttpError({
    status,
    statusText,
    body: undefined,
    url: "https://americas.api.riotgames.com/lol/tournament/v5/codes",
    headers: new Headers(),
  });
}

describe("tournament errors", () => {
  test("are RiotHttpError, so the shared upstream policy applies", () => {
    // extractHttpStatus is `instanceof RiotHttpError` on purpose, so that
    // similarly-shaped errors from Discord and elsewhere do not inherit Riot's
    // upstream-outage policy. Throwing any other type from the tournament shim
    // would silently opt every tournament call out of the 404 handling, the
    // expected-outage list, and the Sentry rules in riot-call.ts.
    expect(extractHttpStatus(riotError(429, "Too Many Requests"))).toBe(429);
  });

  test("carry the status so a failed lobby creation can explain itself", () => {
    const error = riotError(403, "Forbidden");
    expect(error.message).toContain("403");
    expect(error.message).toContain("Forbidden");
  });
});

describe("mode seam", () => {
  test("selects the stub or live path prefix", () => {
    expect(tournamentBasePath("stub")).toBe("lol/tournament-stub/v5");
    expect(tournamentBasePath("live")).toBe("lol/tournament/v5");
  });

  test("games/by-code exists only on the live API", () => {
    // Branching on this rather than catching a 404 matters: a 404 is also how
    // Riot reports a code it has never seen, and conflating the two would turn
    // "we are on the stub" into "that lobby never played".
    expect(supportsGamesByCode("stub")).toBe(false);
    expect(supportsGamesByCode("live")).toBe(true);
  });
});

describe("region mapping", () => {
  test("maps Scout regions to tournament region codes", () => {
    expect(toTournamentRegion("AMERICA_NORTH")).toBe("NA");
    expect(toTournamentRegion("EU_WEST")).toBe("EUW");
    expect(toTournamentRegion("EU_EAST")).toBe("EUNE");
    expect(toTournamentRegion("KOREA")).toBe("KR");
  });

  test("supplies the platform id that games/by-code omits", () => {
    // games/by-code answers with a bare numeric gameId; Match-V5 wants
    // {PLATFORM}_{gameId}.
    expect(toPlatformId("AMERICA_NORTH")).toBe("NA1");
    expect(toPlatformId("EU_WEST")).toBe("EUW1");
  });
});

function respond(value: unknown) {
  return () => Promise.resolve(value);
}

function rejectWith(error: unknown) {
  return async (): Promise<unknown> => {
    throw error;
  };
}

describe("lobby-event parsing through the shared wrapper", () => {
  const validEvents = {
    eventList: [
      {
        timestamp: "1780816258099",
        eventType: "PlayerJoinedGameEvent",
        puuid: "player-one",
      },
    ],
  };

  test("parses a well-formed event list", async () => {
    const result = await callRiotOrUndefined(
      {
        source: "test-lobby-events",
        schema: RawLobbyEventListSchema,
        context: {},
      },
      respond(validEvents),
    );
    expect(result?.eventList).toHaveLength(1);
  });

  test("accepts an unrecognised eventType rather than failing the poll", async () => {
    // eventType is z.string() on purpose. The endpoint replays its whole event
    // list every call, so a new Riot event type modelled as an enum would fail
    // the parse and take that lobby's poll down permanently.
    const result = await callRiotOrUndefined(
      {
        source: "test-lobby-events-unknown",
        schema: RawLobbyEventListSchema,
        context: {},
      },
      respond({
        eventList: [
          {
            timestamp: "1",
            eventType: "SomeFutureRiotEvent",
            puuid: "player-one",
          },
        ],
      }),
    );
    expect(result?.eventList[0]?.eventType).toBe("SomeFutureRiotEvent");
  });

  test("strips additive drift instead of failing", async () => {
    const result = await callRiotOrUndefined(
      {
        source: "test-lobby-events-drift",
        schema: RawLobbyEventListSchema,
        context: {},
      },
      respond({
        eventList: [
          {
            timestamp: "1",
            eventType: "PlayerJoinedGameEvent",
            puuid: "player-one",
            surpriseField: true,
          },
        ],
      }),
    );
    expect(result?.eventList[0]).toEqual({
      timestamp: "1",
      eventType: "PlayerJoinedGameEvent",
      puuid: "player-one",
    });
  });

  test("folds a 404 to undefined for the poll path", async () => {
    const result = await callRiotOrUndefined(
      {
        source: "test-lobby-events-404",
        schema: RawLobbyEventListSchema,
        context: {},
      },
      rejectWith(riotError(404, "Not Found")),
    );
    expect(result).toBeUndefined();
  });

  test("folds an expected upstream outage to undefined", async () => {
    const result = await callRiotOrUndefined(
      {
        source: "test-lobby-events-503",
        schema: RawLobbyEventListSchema,
        context: {},
      },
      rejectWith(riotError(503, "Service Unavailable")),
    );
    expect(result).toBeUndefined();
  });
});
