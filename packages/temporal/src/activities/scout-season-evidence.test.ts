import { describe, expect, it } from "bun:test";
import { hasIndependentSeasonSources } from "./scout-season-evidence.ts";

describe("hasIndependentSeasonSources", () => {
  it("accepts one official Riot source and one wiki source", () => {
    expect(
      hasIndependentSeasonSources([
        "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/",
        "https://wiki.leagueoflegends.com/en-us/Season_2026",
      ]),
    ).toBeTrue();
  });

  it("rejects multiple URLs from only the official Riot source family", () => {
    expect(
      hasIndependentSeasonSources([
        "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/",
        "https://support-leagueoflegends.riotgames.com/hc/en-us/articles/season-2026",
      ]),
    ).toBeFalse();
  });

  it("rejects multiple URLs from only the wiki source family", () => {
    expect(
      hasIndependentSeasonSources([
        "https://wiki.leagueoflegends.com/en-us/Season_2026",
        "https://wiki.leagueoflegends.com/en-us/Patch_26.1",
      ]),
    ).toBeFalse();
  });

  it("does not count an unknown origin as independent corroboration", () => {
    expect(
      hasIndependentSeasonSources([
        "https://wiki.leagueoflegends.com/en-us/Season_2026",
        "https://example.com/season-2026",
      ]),
    ).toBeFalse();
  });
});
