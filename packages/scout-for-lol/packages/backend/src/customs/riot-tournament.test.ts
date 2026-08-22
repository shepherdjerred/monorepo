import { describe, expect, test } from "vitest";
import {
  getTournamentGames,
  RiotTournamentApiError,
} from "#src/customs/riot-tournament.ts";

const unavailableFetch = () =>
  Promise.resolve(new Response("unavailable", { status: 503 }));

const malformedFetch = () =>
  Promise.resolve(Response.json({ unexpected: "payload" }));

describe("Riot Tournament-V5 games", () => {
  test("classifies rejected Riot responses as upstream errors", async () => {
    await expect(
      getTournamentGames("CODE", unavailableFetch),
    ).rejects.toBeInstanceOf(RiotTournamentApiError);
  });

  test("classifies malformed Riot payloads as upstream errors", async () => {
    await expect(getTournamentGames("CODE", malformedFetch)).rejects.toThrow(
      "Riot Tournament-V5 returned an invalid games payload",
    );
  });
});
