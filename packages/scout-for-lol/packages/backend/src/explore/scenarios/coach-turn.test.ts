import {
  COACH_APP_INITIATIONS,
  ExploreScenarioInitiationSchema,
  type ExploreScenarioGameContext,
} from "@scout-for-lol/data";
import { DiscordAccountIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import { DiscordGuildIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { describe, expect, test } from "vitest";
import { APP_TURN_QUESTIONS } from "#src/coach/app-turns.ts";
import { CoachTurnInitiationSchema } from "#src/coach/context-policy.ts";
import type { ExploreAgentResult } from "#src/explore/agent.ts";
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import {
  gateScenarioCoachTurn,
  scenarioCoachQuestion,
} from "#src/explore/scenarios/coach-turn.ts";
import { loadScenarioCorpus } from "#src/explore/scenarios/plan.ts";
import { runReplayCase } from "#src/explore/replay/runner.ts";
import type { ScenarioGateWorld } from "#src/explore/scenarios/coach-turn.ts";
import { ExploreAnswerSchema } from "@scout-for-lol/data";

const { corpus } = await loadScenarioCorpus();

function gameContextOf(caseId: string): ExploreScenarioGameContext {
  const context = corpus.cases
    .find((entry) => entry.id === caseId)
    ?.turns.find((turn) => turn.gameContext !== undefined)?.gameContext;
  if (context === undefined) throw new Error(`${caseId} has no game context`);
  return context;
}

const WORLD: ScenarioGateWorld = {
  caseId: "desktop-coach-postgame-review",
  players: [
    {
      alias: "Koala",
      discordId: null,
      feedChannelIds: [],
      account: {
        puuid: LeaguePuuidSchema.parse("5ce4a710-0000-4000-8000-000000000002"),
        gameName: "n",
        tagLine: "t",
        region: "AMERICA_NORTH",
        games: 3,
        latestMatchId: "NA1_2222222222",
      },
    },
  ],
};

describe("the scenario coach gate", () => {
  test("the corpus initiations are exactly the server's", () => {
    expect([...ExploreScenarioInitiationSchema.options].toSorted()).toEqual(
      [...CoachTurnInitiationSchema.options].toSorted(),
    );
  });

  test("a player-asked live turn reaches the agent with live state", () => {
    const turn = gateScenarioCoachTurn(
      gameContextOf("desktop-coach-live-player-asked"),
      WORLD,
    );
    expect(turn.projection.accepted).toEqual(["live"]);
    expect(turn.coach?.live?.game.gameTimeSecs).toBeGreaterThan(0);
  });

  test("a Scout-started champion-select turn never sees live state", () => {
    const turn = gateScenarioCoachTurn(
      gameContextOf("desktop-coach-app-champ-select-no-live"),
      WORLD,
    );
    expect(turn.projection.present).toEqual(["champSelect", "live"]);
    expect(turn.projection.withheld).toEqual([
      { section: "live", reason: "not_player_initiated" },
    ]);
    expect(turn.coach?.live).toBeUndefined();
    expect(turn.coach?.champSelect).toBeDefined();
  });

  test("the live kill switch withholds live state from a player-asked turn", () => {
    const turn = gateScenarioCoachTurn(
      {
        ...gameContextOf("desktop-coach-live-player-asked"),
        liveAnswersEnabled: false,
      },
      WORLD,
    );
    expect(turn.coach).toBeNull();
    expect(turn.projection.withheld[0]?.reason).toBe("live_answers_disabled");
  });

  test("a post-game turn reviews the tracked player's latest recorded match", () => {
    const turn = gateScenarioCoachTurn(
      gameContextOf("desktop-coach-postgame-review"),
      WORLD,
    );
    expect(turn.coach?.postgame?.matchId).toBe("NA1_2222222222");
  });

  test("a context outside the contract is refused, not trimmed", () => {
    const tampered = {
      initiation: "player_typed",
      liveAnswersEnabled: true,
      context: { postgame: { matchId: "NA1_1", enemyCooldowns: [] } },
    } as const;
    expect(() => gateScenarioCoachTurn(tampered, WORLD)).toThrow(/refuses/);
  });

  test("every Scout-started turn in the corpus quotes the server's wording", () => {
    for (const entry of corpus.cases) {
      for (const turn of entry.turns) {
        const game = turn.gameContext;
        if (game === undefined) continue;
        expect(
          () => scenarioCoachQuestion(turn.question, game),
          entry.id,
        ).not.toThrow();
      }
    }
    for (const initiation of COACH_APP_INITIATIONS) {
      expect(() =>
        scenarioCoachQuestion("not the server wording", {
          ...gameContextOf("desktop-coach-pregame-plan"),
          initiation,
        }),
      ).toThrow(APP_TURN_QUESTIONS[initiation]);
    }
    expect(
      scenarioCoachQuestion("buy now", gameContextOf("voice-coach-terse")),
    ).toBe("buy now");
  });
});

describe("a coach turn through the replay runner", () => {
  test("the fake model receives only the projected context", async () => {
    const seen: (ExploreAgentParams["coach"] | undefined)[] = [];
    const result: ExploreAgentResult = {
      answer: ExploreAnswerSchema.parse({
        answer: "Consider a pick.",
        coachOptions: [
          { label: "Ornn", rationale: "Adds the frontline your team lacks." },
          { label: "Shen", rationale: "Lets you help the lanes that need it." },
        ],
      }),
      preview: null,
      visualization: null,
      matchCards: [],
      loadoutCards: [],
    };
    const gated = gateScenarioCoachTurn(
      gameContextOf("desktop-coach-app-champ-select-no-live"),
      WORLD,
    );
    const observation = await runReplayCase(
      {
        caseId: "desktop-coach-app-champ-select-no-live/desktop/0",
        kind: "conversation",
        conversationId: "11111111-1111-4111-8111-111111111111",
        question: APP_TURN_QUESTIONS.app_champ_select,
        history: [],
        requesterId: DiscordAccountIdSchema.parse("100000000000000001"),
        guildIds: [DiscordGuildIdSchema.parse("222222222222222222")],
        surface: "desktop",
        originChannelId: null,
        coach: gated.coach,
      },
      {
        executeAgent: async (params) => {
          seen.push(params.coach);
          await Promise.resolve();
          return result;
        },
        resolveCapabilities: async () => ({
          dares: false,
          challenges: false,
          creation: false,
          riotHistory: false,
          mvpVotes: false,
          clash: false,
          hallOfFame: false,
        }),
        now: () => 0,
        timeoutMs: 30_000,
        newRunId: () => "run-1",
      },
    );
    expect(observation.status).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.champSelect).toBeDefined();
    expect(seen[0]?.live).toBeUndefined();
    const digest = JSON.stringify(observation.modelMessages);
    expect(digest).toContain("Game context from Scout Desktop");
    expect(digest).not.toContain("gameTimeSecs");
    expect(observation.answer?.coachOptions).toHaveLength(2);
  });
});
