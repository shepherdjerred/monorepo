import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ExploreMatchCardSchema } from "@scout-for-lol/data";
import { ExploreMatchCards } from "#src/components/explore/explore-match-cards.tsx";

function card(size: "S" | "M" | "L") {
  const matchId =
    size === "S"
      ? "NA1_5635906024"
      : size === "M"
        ? "NA1_5635906025"
        : "NA1_5635906026";
  return ExploreMatchCardSchema.parse({
    size,
    match: {
      matchId,
      gameCreationMs: 1_788_627_280_000,
      gameDurationSeconds: 1728,
      queue: "Ranked Solo",
      queueId: 420,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      gameVersion: "16.17.1",
      mapId: 11,
      teams: [
        {
          teamId: 100,
          win: true,
          kills: 91,
          objectives: { turrets: 8, inhibitors: 1, barons: 1, dragons: 3 },
          participants: [
            {
              participantId: 1,
              riotId: { gameName: "Blue", tagLine: "NA1" },
              championId: 103,
              championName: "Ahri",
              position: "MIDDLE",
              kills: 12,
              deaths: 4,
              assists: 10,
              creepScore: 210,
              goldEarned: 14_000,
              visionScore: 22,
              damageToChampions: 24_000,
              killParticipation: 0.24,
              damageShare: 0.21,
              objectives: { turrets: 2, inhibitors: 0, barons: 0, dragons: 0 },
            },
          ],
        },
        {
          teamId: 200,
          win: false,
          kills: 88,
          objectives: { turrets: 3, inhibitors: 0, barons: 0, dragons: 1 },
          participants: [
            {
              participantId: 6,
              riotId: { gameName: "Red", tagLine: "NA1" },
              championId: 157,
              championName: "Yasuo",
              position: "MIDDLE",
              kills: 11,
              deaths: 8,
              assists: 8,
              creepScore: 194,
              goldEarned: 13_200,
              visionScore: 18,
              damageToChampions: 22_000,
              killParticipation: 0.22,
              damageShare: 0.2,
              objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
            },
          ],
        },
      ],
    },
  });
}

describe("ExploreMatchCards", () => {
  test("renders the chosen progressive detail without inventing match facts", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ExploreMatchCards cards={[card("S"), card("M"), card("L")]} />
      </MemoryRouter>,
    );
    expect(markup).toContain("91 – 88");
    expect(markup).toContain("Patch 16.17.1");
    expect(markup).toContain("Blue#NA1");
    expect(markup).toContain("View match details");
    expect(markup).toContain("/explore/matches/NA1_5635906026");
  });

  test("omits the artifact region when the model selects no cards", () => {
    expect(renderToStaticMarkup(<ExploreMatchCards cards={[]} />)).toBe("");
  });
});
