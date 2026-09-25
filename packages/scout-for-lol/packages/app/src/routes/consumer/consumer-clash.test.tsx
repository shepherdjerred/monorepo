import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ClashHistorySection } from "#src/routes/consumer/consumer-clash-history.tsx";
import {
  clashTeamLabel,
  formatClashInstant,
  formatClashIso,
  phaseLabel,
  sightingOutcomeLabel,
  titleCaseToken,
} from "#src/routes/consumer/consumer-clash-copy.ts";

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
    expect(sightingOutcomeLabel("win")).toBe("Win · scored through Feb 2026");
    expect(sightingOutcomeLabel("loss")).toBe("Loss · scored through Feb 2026");
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
      renderToStaticMarkup(
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
      renderToStaticMarkup(
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
      renderToStaticMarkup(
        <ClashHistorySection
          history={{
            isPending: false,
            isError: false,
            isSuccess: true,
            error: null,
            data: {
              cups: [],
              resultsNote: "Past Clash lobbies Scout saw.",
            },
          }}
        />,
      ),
    ).toContain("No past Clash lobbies for tracked players yet.");
  });

  test("renders scored leftovers, lobby badges, and a team without a tag", () => {
    const markup = renderToStaticMarkup(
      <ClashHistorySection
        history={{
          isPending: false,
          isError: false,
          isSuccess: true,
          error: null,
          data: {
            resultsNote:
              "Past Clash lobbies Scout saw. Current weekends have no score. Games through Feb 2026 may show a result.",
            cups: [
              {
                id: "2026-W12:noxus:day_1:clash",
                cupKey: "noxus",
                cupDay: "day_1",
                themeLabel: "Noxus · Day 1",
                queue: "clash",
                players: [
                  {
                    puuid: "p".repeat(78),
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
                    puuid: "p".repeat(78),
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
    expect(markup).toContain("Win · scored through Feb 2026");
    expect(markup).toContain(
      "Past Clash lobbies Scout saw. Current weekends have no score. Games through Feb 2026 may show a result.",
    );
  });
});
