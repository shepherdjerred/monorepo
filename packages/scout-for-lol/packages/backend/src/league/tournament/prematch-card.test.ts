import { describe, expect, test } from "vitest";
import {
  buildLobbyPrematchEmbed,
  describeLobby,
} from "#src/league/tournament/prematch-card.ts";
import { openLobby } from "#src/league/tournament/open-lobby-fixture.ts";

describe("open tournament-lobby cards", () => {
  test("shows a team-neutral joined-player roster without inventing teams", () => {
    const embed = buildLobbyPrematchEmbed(openLobby(), ["Player#NA1"]).toJSON();

    expect(embed.title).toBe("Custom game starting — 5v5");
    expect(embed.fields).toEqual([
      {
        name: "Players",
        value: "• Player#NA1",
      },
    ]);
  });

  test("shows the joined count when identity enrichment is unavailable", () => {
    const embed = buildLobbyPrematchEmbed(openLobby()).toJSON();

    expect(embed.fields).toEqual([
      {
        name: "Open lobby",
        value: "1 player(s) joined · teams are set in League",
      },
    ]);
  });

  test("describes an open lobby in private status output", () => {
    expect(describeLobby(openLobby())).toContain("Open lobby · 5v5 · 1 joined");
  });
});
