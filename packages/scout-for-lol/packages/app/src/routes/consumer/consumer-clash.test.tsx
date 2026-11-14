import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import { ClashHistorySection } from "#src/routes/consumer/consumer-clash-history.tsx";
import { ClashBracketSection } from "#src/routes/consumer/consumer-clash-bracket.tsx";
import {
  clashTeamLabel,
  formatClashInstant,
  formatClashIso,
  phaseLabel,
  sightingOutcomeLabel,
  titleCaseToken,
} from "#src/routes/consumer/consumer-clash-copy.ts";

const MATCH_ID = RiotMatchIdSchema.parse("NA1_5800000001");

function renderInRouter(node: ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe("Clash copy helpers", () => {
  test("title-cases Riot role tokens", () => {
    expect(titleCaseToken("CAPTAIN")).toBe("Captain");
    expect(titleCaseToken("FILL")).toBe("Fill");
    expect(titleCaseToken("TOP")).toBe("Top");
  });

  test("formats missing Clash instants as an em dash", () => {
    expect(formatClashInstant(0)).toBe("—");
    expect(formatClashInstant(Number.NaN)).toBe("—");
  });

  test("labels cancelled, open, started, and upcoming phases", () => {
    const registrationTime = Date.parse("2026-09-19T17:00:00.000Z");
    const startTime = Date.parse("2026-09-20T17:00:00.000Z");
    expect(
      phaseLabel({
        cancelled: true,
        registrationTime,
        startTime,
        now: registrationTime,
      }),
    ).toBe("Cancelled");
    expect(
      phaseLabel({
        cancelled: false,
        registrationTime,
        startTime,
        now: registrationTime,
      }),
    ).toBe("Registration open");
    expect(
      phaseLabel({
        cancelled: false,
        registrationTime,
        startTime,
        now: startTime,
      }),
    ).toBe("Started");
    expect(
      phaseLabel({
        cancelled: false,
        registrationTime,
        startTime,
        now: registrationTime - 1,
      }),
    ).toBe("Upcoming");
  });

  test("formats Clash ISO instants and labels lobby versus scored leftovers", () => {
    expect(formatClashIso("not-a-date")).toBe("—");
    expect(sightingOutcomeLabel("lobby")).toBe("Lobby only");
    expect(sightingOutcomeLabel("win")).toBe("Win");
    expect(sightingOutcomeLabel("loss")).toBe("Loss");
    expect(sightingOutcomeLabel("unresolved")).toBe("Result unresolved");
  });

  test("shows a Clash team name even when the tag is missing", () => {
    expect(
      clashTeamLabel({
        teamAbbreviation: "WLV",
        teamName: "WE LOVE VIRMEL",
      }),
    ).toBe("WLV · WE LOVE VIRMEL");
    expect(
      clashTeamLabel({
        teamName: "WE LOVE VIRMEL",
      }),
    ).toBe("WE LOVE VIRMEL");
    expect(
      clashTeamLabel({
        teamAbbreviation: "WLV",
      }),
    ).toBe("WLV");
    expect(clashTeamLabel({})).toBeUndefined();
  });
});

describe("ClashHistorySection", () => {
  test("shows loading, error, and empty copy", () => {
    expect(
      renderInRouter(
        <ClashHistorySection
          history={{
            isPending: true,
            isError: false,
            isSuccess: false,
            error: null,
            data: undefined,
          }}
        />,
      ),
    ).toContain("Loading history…");
    expect(
      renderInRouter(
        <ClashHistorySection
          history={{
            isPending: false,
            isError: true,
            isSuccess: false,
            error: { message: "Clash history is unavailable" },
            data: undefined,
          }}
        />,
      ),
    ).toContain("Clash history is unavailable");
    expect(
      renderInRouter(
        <ClashHistorySection
          history={{
            isPending: false,
            isError: false,
            isSuccess: true,
            error: null,
            data: {
              brackets: [],
              cups: [],
              resultsNote: "Past Clash lobbies Scout saw.",
            },
          }}
        />,
      ),
    ).toContain("No past Clash lobbies for tracked players yet.");
  });

  test("renders scored leftovers, lobby badges, and a team without a tag", () => {
    const markup = renderInRouter(
      <ClashHistorySection
        history={{
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
          data: {
            brackets: [],
            resultsNote:
              "Past Clash games and client-observed brackets. Results appear when Riot or Scout Client supplies a completed game.",
            cups: [
              {
                id: "2026-W12:noxus:day_1:clash",
                cupKey: "noxus",
                cupDay: "day_1",
                themeLabel: "Noxus · Day 1",
                queue: "clash",
                players: [
                  {
                    puuid: LeaguePuuidSchema.parse("p".repeat(78)),
                    playerAlias: "Scout Classic",
                    teamName: "WE LOVE VIRMEL",
                    teamAbbreviation: "WLV",
                    sightings: [
                      {
                        platform: "NA1",
                        gameId: "1",
                        observedAt: "2026-03-22T01:30:00.000Z",
                        championId: 157,
                        championName: "Yasuo",
                        queue: "clash",
                        matchIndex: 1,
                        outcome: "lobby",
                        matchId: null,
                      },
                      {
                        platform: "NA1",
                        gameId: "2",
                        observedAt: "2026-03-22T03:00:00.000Z",
                        championId: 222,
                        championName: "Jinx",
                        queue: "clash",
                        matchIndex: 2,
                        outcome: "lobby",
                        matchId: null,
                      },
                    ],
                  },
                ],
              },
              {
                id: "2026-W04:demacia:day_1:clash",
                cupKey: "demacia",
                cupDay: "day_1",
                themeLabel: "Demacia · Day 1",
                queue: "clash",
                players: [
                  {
                    puuid: LeaguePuuidSchema.parse("p".repeat(78)),
                    playerAlias: "Scout Classic",
                    teamName: "Nameless Side",
                    sightings: [
                      {
                        platform: "NA1",
                        gameId: "old",
                        observedAt: "2026-01-25T02:30:00.000Z",
                        championId: 157,
                        championName: "Yasuo",
                        queue: "clash",
                        matchIndex: 1,
                        outcome: "win",
                        matchId: MATCH_ID,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(markup).toContain("Noxus · Day 1");
    expect(markup).toContain("WLV · WE LOVE VIRMEL");
    expect(markup).toContain("Lobby only");
    expect(markup).toContain("Match 2");
    expect(markup).toContain("Demacia · Day 1");
    expect(markup).toContain("Nameless Side");
    expect(markup).toContain(">Win<");
    expect(markup).toContain(
      "Past Clash games and client-observed brackets. Results appear when Riot or Scout Client supplies a completed game.",
    );
  });

  test("links finished games to their match page and leaves lobbies plain", () => {
    const sighting = {
      platform: "NA1",
      observedAt: "2026-03-22T01:30:00.000Z",
      championId: 157,
      championName: "Yasuo",
      queue: "clash",
    };
    const markup = renderInRouter(
      <ClashHistorySection
        history={{
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
          data: {
            resultsNote: "Past Clash games.",
            brackets: [],
            cups: [
              {
                id: "2026-W12:noxus:day_1:clash",
                cupKey: "noxus",
                cupDay: "day_1",
                themeLabel: "Noxus · Day 1",
                queue: "clash",
                players: [
                  {
                    puuid: LeaguePuuidSchema.parse("p".repeat(78)),
                    playerAlias: "Scout Classic",
                    sightings: [
                      {
                        ...sighting,
                        gameId: "5800000001",
                        matchIndex: 1,
                        outcome: "win",
                        matchId: MATCH_ID,
                      },
                      {
                        ...sighting,
                        gameId: "5800000002",
                        matchIndex: 2,
                        outcome: "lobby",
                        matchId: null,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(markup).toContain('href="/explore/matches/NA1_5800000001"');
    expect(markup.match(/href="\/explore\/matches\//g)).toHaveLength(1);
    expect(markup).toContain("Match 2 · Yasuo");
  });
});

describe("ClashBracketSection", () => {
  test("links a round to its game only when a tracked player played it", () => {
    const round = {
      opponent: {
        kind: "team" as const,
        name: "Dragon Pit",
        abbreviation: "DP",
      },
      status: null,
      gameIds: [],
    };
    const markup = renderInRouter(
      <ClashBracketSection
        history
        brackets={[
          {
            platformId: "NA1",
            tournamentId: "101",
            rosterId: "own",
            name: "WE LOVE VIRMEL",
            abbreviation: "WLV",
            tier: 3,
            memberAliases: ["Scout Classic"],
            capturedAt: "2026-03-22T04:00:00.000Z",
            matches: [
              {
                ...round,
                round: 1,
                result: "won",
                matchIds: ["NA1_5800000001"],
              },
              { ...round, round: 2, result: "lost", matchIds: [] },
              {
                ...round,
                round: 3,
                result: "pending",
                matchIds: ["NA1_5800000003", "NA1_5800000004"],
              },
            ],
          },
        ]}
      />,
    );
    expect(markup).toContain('href="/explore/matches/NA1_5800000001"');
    expect(markup).toContain("View match");
    // Several games link each game and still claim no series winner.
    expect(markup).toContain("Game 1");
    expect(markup).toContain("Game 2");
    expect(markup).toContain("Up next");
    expect(markup.match(/href="\/explore\/matches\//g)).toHaveLength(3);
    expect(markup).toContain("Round 2 · vs Dragon Pit");
  });
});
