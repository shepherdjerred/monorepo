import { describe, expect, test } from "vitest";
import { LocalMatchBundleSchema } from "./lcu-schema.ts";
import { firstObjectiveTeam } from "./lcu-team.ts";

/** Redacted `games/{id}` and `game-timelines/{id}` from a real ranked game. */
async function rankedGame() {
  const dir = new URL("../../../../../testdata/lcu/", import.meta.url);
  const bundle = LocalMatchBundleSchema.parse({
    matchHistory: await Bun.file(
      new URL("lcu-game-ranked-solo.json", dir),
    ).json(),
    timeline: await Bun.file(
      new URL("lcu-timeline-ranked-solo.json", dir),
    ).json(),
    timing: { gameStartTimestamp: 1, gameEndTimestamp: 2 },
  });
  return { game: bundle.matchHistory, timeline: bundle.timeline };
}

function teamOf(
  game: { participants: { participantId: number; teamId: number }[] },
  id: number,
) {
  return game.participants.find(
    (participant) => participant.participantId === id,
  )?.teamId;
}

describe("firstObjectiveTeam", () => {
  test("credits the only team that took the objective", async () => {
    const { game, timeline } = await rankedGame();

    // Only blue took a herald in this game.
    expect(
      firstObjectiveTeam({
        game,
        timeline,
        kills: (team) => team.riftHeraldKills,
        monsterType: "RIFTHERALD",
      }),
    ).toBe(100);
  });

  test("reads the timeline when both teams took one", async () => {
    const { game, timeline } = await rankedGame();

    // Both teams took voidgrubs; participant 7 killed the first.
    expect(
      firstObjectiveTeam({
        game,
        timeline,
        kills: (team) => team.hordeKills,
        monsterType: "HORDE",
      }),
    ).toBe(teamOf(game, 7));
  });

  test("is null when no team took one", async () => {
    const { game, timeline } = await rankedGame();

    expect(
      firstObjectiveTeam({
        game,
        timeline,
        kills: () => 0,
        monsterType: "RIFTHERALD",
      }),
    ).toBeNull();
  });

  test("can't tell when both took one and there's no timeline", async () => {
    const { game } = await rankedGame();

    expect(
      firstObjectiveTeam({
        game,
        timeline: undefined,
        kills: (team) => team.hordeKills,
        monsterType: "HORDE",
      }),
    ).toBeUndefined();
  });

  test("can't tell when the League client didn't count the objective", async () => {
    const { game, timeline } = await rankedGame();
    const uncounted = {
      ...game,
      teams: game.teams.map(({ hordeKills: _omitted, ...team }) => team),
    };

    expect(
      firstObjectiveTeam({
        game: uncounted,
        timeline,
        kills: (team) => team.hordeKills,
        monsterType: "HORDE",
      }),
    ).toBeUndefined();
  });
});
