import { describe, expect, test } from "vitest";
import corpus from "#src/model/reports/explore-scenario-corpus.json" with { type: "json" };
import { ExploreScenarioCorpusSchema } from "#src/model/reports/explore-scenario-corpus.ts";

describe("the Explore scenario corpus", () => {
  const parsed = ExploreScenarioCorpusSchema.parse(corpus);

  test("holds Scout Desktop cases for the coach content limit and for options", () => {
    const desktop = parsed.cases.filter(
      (entry) => entry.surfaces.length === 1 && entry.surfaces[0] === "desktop",
    );
    expect(desktop.map((entry) => entry.id).toSorted()).toEqual([
      "desktop-coach-app-champ-select-no-live",
      "desktop-coach-champ-select-options",
      "desktop-coach-end-of-game-timeline-question",
      "desktop-coach-live-enemy-cooldowns-refused",
      "desktop-coach-live-player-asked",
      "desktop-coach-postgame-review",
      "desktop-coach-postgame-review-end-of-game",
      "desktop-coach-pregame-plan",
      "desktop-enemy-cooldowns",
      "desktop-fog-inference",
      "desktop-hidden-identity",
      "desktop-my-stats",
      "desktop-pick-without-context",
    ]);
  });

  test("every content-limit case judges that Scout refuses and does not guess", () => {
    for (const id of [
      "desktop-enemy-cooldowns",
      "desktop-fog-inference",
      "desktop-hidden-identity",
    ]) {
      const entry = parsed.cases.find((candidate) => candidate.id === id);
      const rubric = entry?.turns.flatMap((turn) => turn.expect?.rubric ?? []);
      expect(rubric, id).toBeDefined();
      expect(rubric?.join(" "), id).toMatch(/does not|cannot|Does not/);
    }
  });

  test("the champion-select case asks for options and forbids commands", () => {
    const entry = parsed.cases.find(
      (candidate) => candidate.id === "desktop-pick-without-context",
    );
    const expectation = entry?.turns[0]?.expect;
    expect(expectation?.rubric.join(" ")).toContain("two to four options");
    expect(expectation?.mustNotMention).toContain("you must pick");
  });

  describe("game contexts", () => {
    const turnsWithContext = parsed.cases.flatMap((entry) =>
      entry.turns.flatMap((turn) =>
        turn.gameContext === undefined ? [] : [{ id: entry.id, turn }],
      ),
    );

    test("the coach cases carry a context and run on the desktop alone", () => {
      expect(turnsWithContext.map((entry) => entry.id).toSorted()).toEqual([
        "desktop-coach-app-champ-select-no-live",
        "desktop-coach-champ-select-options",
        "desktop-coach-end-of-game-timeline-question",
        "desktop-coach-live-enemy-cooldowns-refused",
        "desktop-coach-live-player-asked",
        "desktop-coach-postgame-review",
        "desktop-coach-postgame-review-end-of-game",
        "desktop-coach-pregame-plan",
        "voice-coach-terse",
      ]);
      for (const { id, turn } of turnsWithContext) {
        const entry = parsed.cases.find((candidate) => candidate.id === id);
        expect(entry?.surfaces, id).toEqual([
          turn.gameContext?.initiation === "player_voice" ? "voice" : "desktop",
        ]);
      }
    });

    test("covers every initiation the harness can exercise", () => {
      const initiations = new Set(
        turnsWithContext.map((entry) => entry.turn.gameContext?.initiation),
      );
      expect(initiations).toEqual(
        new Set([
          "player_typed",
          "player_voice",
          "app_champ_select",
          "app_pregame",
          "app_postgame",
        ]),
      );
    });

    test("the Scout-started champion-select case sends live state the gate must withhold", () => {
      const entry = turnsWithContext.find(
        (candidate) =>
          candidate.id === "desktop-coach-app-champ-select-no-live",
      );
      const context = entry?.turn.gameContext?.context;
      expect(context?.champSelect).toBeDefined();
      expect(context?.live).toBeDefined();
    });

    test("the end-of-game review cases run on an end-of-game-only game and judge timeline claims", () => {
      for (const id of [
        "desktop-coach-postgame-review-end-of-game",
        "desktop-coach-end-of-game-timeline-question",
      ]) {
        const entry = parsed.cases.find((candidate) => candidate.id === id);
        const [player] = entry?.guild.players ?? [];
        expect(player?.linkedToAsker, id).toBe(true);
        expect(player?.account, id).toMatchObject({
          kind: "lake",
          latestEndOfGame: true,
          withTimeline: false,
        });
        const turn = entry?.turns[0];
        expect(turn?.gameContext?.postgameOf, id).toBe(player?.alias);
        expect(turn?.expect?.toolsCalled, id).toEqual([["review_match"]]);
        expect(turn?.expect?.rubric.join(" "), id).toMatch(/timeline/);
      }
    });

    const base = parsed.cases.find(
      (candidate) => candidate.id === "desktop-coach-pregame-plan",
    );
    const rebuild = (overrides: Record<string, unknown>) =>
      ExploreScenarioCorpusSchema.safeParse({
        version: 1,
        cases: [{ ...base, ...overrides }],
      });

    test("rejects a context the coach contract does not allow", () => {
      const turn = base?.turns[0];
      const result = rebuild({
        turns: [
          {
            ...turn,
            gameContext: {
              initiation: "app_pregame",
              context: { live: { enemyCooldowns: [] } },
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    test("rejects an initiation the gate does not know", () => {
      const turn = base?.turns[0];
      const result = rebuild({
        turns: [
          {
            ...turn,
            gameContext: {
              ...turn?.gameContext,
              initiation: "app_made_up",
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    test("rejects a game context on a surface that is not its own", () => {
      expect(rebuild({ surfaces: ["web", "desktop"] }).success).toBe(false);
      expect(rebuild({ surfaces: ["voice"] }).success).toBe(false);
    });

    test("rejects a post-game player the guild does not track", () => {
      const turn = base?.turns[0];
      const result = rebuild({
        turns: [
          {
            ...turn,
            gameContext: {
              initiation: "player_typed",
              postgameOf: "Nobody",
              context: { postgame: { matchId: "NA1_1000000000" } },
            },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    test("rejects an unknown coach option expectation", () => {
      const turn = base?.turns[0];
      const result = rebuild({
        turns: [
          { ...turn, expect: { ...turn?.expect, coachOptions: "sometimes" } },
        ],
      });
      expect(result.success).toBe(false);
    });
  });
});
