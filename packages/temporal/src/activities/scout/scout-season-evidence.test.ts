import { describe, expect, it } from "vitest";
import {
  currentSeasonDateClaims,
  hasIndependentSeasonSources,
  seasonDateClaimsFromDiff,
  unsupportedSeasonDates,
} from "./scout-season-evidence.ts";

describe("hasIndependentSeasonSources", () => {
  it("accepts one official Riot source and one wiki source", () => {
    expect(
      hasIndependentSeasonSources([
        "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/",
        "https://wiki.leagueoflegends.com/en-us/Season_2026",
      ]),
    ).toBe(true);
  });

  it("rejects multiple URLs from only the official Riot source family", () => {
    expect(
      hasIndependentSeasonSources([
        "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/",
        "https://support-leagueoflegends.riotgames.com/hc/en-us/articles/season-2026",
      ]),
    ).toBe(false);
  });

  it("rejects multiple URLs from only the wiki source family", () => {
    expect(
      hasIndependentSeasonSources([
        "https://wiki.leagueoflegends.com/en-us/Season_2026",
        "https://wiki.leagueoflegends.com/en-us/Patch_26.1",
      ]),
    ).toBe(false);
  });

  it("does not count an unknown origin as independent corroboration", () => {
    expect(
      hasIndependentSeasonSources([
        "https://wiki.leagueoflegends.com/en-us/Season_2026",
        "https://example.com/season-2026",
      ]),
    ).toBe(false);
  });
});

describe("season date claim extraction", () => {
  it("extracts only added dates from the seasons file diff", () => {
    const seasonsFile = "packages/scout-for-lol/packages/data/src/seasons.ts";
    expect(
      seasonDateClaimsFromDiff(
        [
          `diff --git a/${seasonsFile} b/${seasonsFile}`,
          `--- a/${seasonsFile}`,
          `+++ b/${seasonsFile}`,
          '-    endDate: new Date("2026-09-21T23:59:59-07:00"),',
          '+    endDate: new Date("2026-09-22T23:59:59-07:00"),',
          "diff --git a/packages/scout-for-lol/packages/frontend/src/data/changelog.tsx b/packages/scout-for-lol/packages/frontend/src/data/changelog.tsx",
          '+    date: "2026-08-10",',
        ].join("\n"),
        seasonsFile,
      ),
    ).toEqual(["2026-09-22"]);
  });

  it("requires the start and end dates of every season that has not ended", () => {
    expect(
      currentSeasonDateClaims(
        [
          '{ startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-02-01T23:59:59Z") },',
          '{ startDate: new Date("2026-07-29T00:00:00Z"), endDate: new Date("2026-09-22T23:59:59Z") },',
          '{ startDate: new Date("2026-09-23T00:00:00Z"), endDate: new Date("2026-11-10T23:59:59Z") },',
        ].join("\n"),
        new Date("2026-08-10T12:00:00Z"),
      ),
    ).toEqual(["2026-07-29", "2026-09-22", "2026-09-23", "2026-11-10"]);
  });
});

describe("unsupportedSeasonDates", () => {
  it("requires every date claim to appear in both source families", () => {
    expect(
      unsupportedSeasonDates(
        [
          {
            url: "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/",
            content:
              "The act runs from July 29, 2026 until September 22, 2026.",
          },
          {
            url: "https://wiki.leagueoflegends.com/en-us/Season_2026",
            content: "The act runs from 29 July 2026 until 22 September 2026.",
          },
        ],
        ["2026-07-29", "2026-09-22"],
      ),
    ).toEqual([]);
  });

  it("rejects reachable pages that do not state the claimed date", () => {
    expect(
      unsupportedSeasonDates(
        [
          {
            url: "https://www.leagueoflegends.com/en-us/news/",
            content: "Season update published September 22, 2026.",
          },
          {
            url: "https://wiki.leagueoflegends.com/en-us/",
            content: "Season update published on 2026-09-22.",
          },
        ],
        ["2026-09-22"],
      ),
    ).toEqual(["2026-09-22"]);
  });

  it("rejects an unrelated date without nearby season semantics", () => {
    expect(
      unsupportedSeasonDates(
        [
          {
            url: "https://www.leagueoflegends.com/en-us/news/game-updates/example/",
            content:
              "September 22, 2026 was this article's publication date. " +
              "x".repeat(500) +
              " The season begins later.",
          },
          {
            url: "https://wiki.leagueoflegends.com/en-us/Season_2026",
            content: "The season act ends on September 22, 2026.",
          },
        ],
        ["2026-09-22"],
      ),
    ).toEqual(["2026-09-22"]);
  });

  it("does not treat two Riot pages as independent corroboration", () => {
    expect(
      unsupportedSeasonDates(
        [
          {
            url: "https://www.leagueoflegends.com/en-us/news/a/",
            content: "September 22, 2026",
          },
          {
            url: "https://support-leagueoflegends.riotgames.com/hc/en-us/articles/b",
            content: "2026-09-22",
          },
        ],
        ["2026-09-22"],
      ),
    ).toEqual(["2026-09-22"]);
  });
});
