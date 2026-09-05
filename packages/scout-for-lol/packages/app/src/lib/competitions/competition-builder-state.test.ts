import { describe, expect, test } from "vitest";
import { getAllSeasons, PlayerIdSchema } from "@scout-for-lol/data";
import {
  buildCompetitionSubmission,
  competitionBuilderReducer,
  initialCompetitionBuilderState,
} from "#src/lib/competitions/competition-builder-state.ts";
import { buildCompetitionScenarios } from "#src/lib/competitions/competition-scenarios.ts";
import { COMPETITION_EXAMPLES } from "#src/lib/onboarding/onboarding-examples.ts";
import { validateForm } from "#src/lib/competitions/competition-form-state.ts";
import { competitionReviewSummary } from "#src/components/competitions/competition-builder-review.tsx";

const NOW = new Date("2026-08-23T18:00:00.000Z");
const TIMEZONE = "America/Los_Angeles";

function scenarios() {
  return buildCompetitionScenarios({
    now: NOW,
    timezone: TIMEZONE,
    seasons: getAllSeasons(),
  });
}

describe("competition scenario library", () => {
  test("contains Blank plus ten available starters at a fixed clock", () => {
    const library = scenarios();
    expect(library.map((scenario) => scenario.id)).toEqual([
      "blank",
      "solo-rank-climb",
      "flex-rank-climb",
      "rank",
      "highest-flex-rank",
      "games-sprint",
      "solo-games",
      "aram-games",
      "solo-wins",
      "yuumi",
      "solo-win-rate",
    ]);
    expect(library.every((scenario) => scenario.value !== null)).toBe(true);
  });

  test.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])(
    "computes each rolling starter in %s at click time",
    (timezone) => {
      const library = buildCompetitionScenarios({
        now: NOW,
        timezone,
        seasons: getAllSeasons(),
      });
      for (const scenario of library.slice(5)) {
        expect(scenario.value?.dates).toMatchObject({
          mode: "FIXED_DATES",
        });
      }
      const games = library.find((scenario) => scenario.id === "games-sprint");
      expect(games?.value?.dates).toEqual({
        mode: "FIXED_DATES",
        startDate: timezone === "Asia/Tokyo" ? "2026-08-24" : "2026-08-23",
        endDate: timezone === "Asia/Tokyo" ? "2026-09-22" : "2026-09-21",
        seasonId: "",
      });
    },
  );

  test("marks rank starters unavailable when no season can be selected", () => {
    const library = buildCompetitionScenarios({
      now: NOW,
      timezone: TIMEZONE,
      seasons: [],
    });
    expect(
      library
        .filter((scenario) => scenario.id.includes("rank"))
        .every((scenario) => scenario.value === null),
    ).toBe(true);
  });

  test("Blank clears basics and dates while retaining an explicit scoring default", () => {
    const blank = scenarios()[0];
    expect(blank?.value).toMatchObject({
      title: "",
      description: "",
      criteria: { criteriaType: "MOST_GAMES_PLAYED", queues: ["ALL"] },
      dates: { startDate: "", endDate: "" },
    });
  });
});

describe("competition builder reducer and submission", () => {
  test("Highest Solo rank submits HIGHEST_RANK, never MOST_GAMES_PLAYED", () => {
    const state = initialCompetitionBuilderState({
      channelId: "200000000000000005",
      timezone: TIMEZONE,
      now: NOW,
      scenarioId: "rank",
    });
    const submission = buildCompetitionSubmission(state);
    expect(submission.ok).toBe(true);
    if (!submission.ok) return;
    expect(submission.value.criteria).toEqual({
      type: "HIGHEST_RANK",
      queues: ["solo"],
      aggregation: "MAX",
    });
  });

  test("the legacy rank starter also builds and validates HIGHEST_RANK", () => {
    const rank = COMPETITION_EXAMPLES.find((example) => example.id === "rank");
    expect(rank).toBeDefined();
    if (rank === undefined) return;
    const result = validateForm(rank.build("200000000000000005"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.criteria).toEqual({
      type: "HIGHEST_RANK",
      queues: ["solo"],
      aggregation: "MAX",
    });
  });

  test("preset switching is atomic and preserves roster and delivery settings", () => {
    const initial = initialCompetitionBuilderState({
      channelId: "200000000000000005",
      timezone: TIMEZONE,
      now: NOW,
      scenarioId: "rank",
    });
    const configured = competitionBuilderReducer(initial, {
      type: "edit",
      changes: {
        channelId: "channel-b",
        visibility: "INVITE_ONLY",
        maxParticipants: "12",
        initialPlayerIds: [PlayerIdSchema.parse(7)],
        scheduledUpdates: {
          enabled: true,
          cronExpression: "30 18 * * 1",
          timezone: "Asia/Tokyo",
        },
      },
    });
    const games = scenarios().find((scenario) => scenario.id === "aram-games");
    expect(games).toBeDefined();
    if (games === undefined) return;
    const switched = competitionBuilderReducer(configured, {
      type: "apply-scenario",
      scenario: games,
    });
    expect(switched).toMatchObject({
      channelId: "channel-b",
      visibility: "INVITE_ONLY",
      maxParticipants: "12",
      initialPlayerIds: [7],
      scheduledUpdates: {
        enabled: true,
        cronExpression: "30 18 * * 1",
        timezone: "Asia/Tokyo",
      },
      criteria: { criteriaType: "MOST_GAMES_PLAYED", queues: ["aram"] },
      customized: false,
    });
  });

  test("marks a selected starter customized after a manual edit", () => {
    const initial = initialCompetitionBuilderState({
      channelId: "channel-a",
      timezone: TIMEZONE,
      now: NOW,
      scenarioId: "rank",
    });
    const edited = competitionBuilderReducer(initial, {
      type: "edit",
      changes: { title: "Our ranked race" },
    });
    expect(edited.customized).toBe(true);
    expect(edited.starter?.label).toBe("Highest Solo rank");
  });

  test("server-wide submission ignores a manual roster", () => {
    const initial = initialCompetitionBuilderState({
      channelId: "200000000000000005",
      timezone: TIMEZONE,
      now: NOW,
      scenarioId: "rank",
    });
    const state = competitionBuilderReducer(initial, {
      type: "edit",
      changes: {
        visibility: "SERVER_WIDE",
        initialPlayerIds: [PlayerIdSchema.parse(7)],
      },
    });
    const result = buildCompetitionSubmission(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.initialPlayerIds).toEqual([]);
  });

  test("review summarizes the actual criterion, queue, roster, dates, and cadence", () => {
    const state = initialCompetitionBuilderState({
      channelId: "channel-a",
      timezone: TIMEZONE,
      now: NOW,
      scenarioId: "rank",
    });
    expect(competitionReviewSummary(state, "competition-updates")).toEqual({
      gameVariant: "Modern League",
      scoring: "Highest rank · Ranked Solo/Duo · Best selected rank",
      window: "League season 2026_SEASON_3_ACT_1",
      entrants: "Open to All · 0 selected tracked player(s)",
      delivery:
        "#competition-updates · Leaderboard updates 0 9 * * * in America/Los_Angeles",
    });
  });
});
