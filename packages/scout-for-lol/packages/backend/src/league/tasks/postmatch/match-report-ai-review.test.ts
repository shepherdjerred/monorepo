import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  CompletedMatchSchema,
  LeaguePuuidSchema,
  RawMatchSchema,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data/index.ts";
import { getAiReviewDecision } from "./match-report-ai-review.ts";

const rawMatchFixture = RawMatchSchema.parse(
  await Bun.file(
    new URL(
      "../../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
      import.meta.url,
    ),
  ).json(),
);
const firstRawPlayer = rawMatchFixture.info.participants[0];
const secondRawPlayer = rawMatchFixture.info.participants[1];
if (firstRawPlayer === undefined || secondRawPlayer === undefined) {
  throw new Error("Match fixture must contain at least two participants");
}

const firstPuuid = LeaguePuuidSchema.parse(firstRawPlayer.puuid);
const secondPuuid = LeaguePuuidSchema.parse(secondRawPlayer.puuid);
const mismatchedPuuid = LeaguePuuidSchema.parse("z".repeat(78));

type Performance = Pick<
  RawParticipant,
  | "kills"
  | "deaths"
  | "assists"
  | "pentaKills"
  | "quadraKills"
  | "win"
  | "gameEndedInEarlySurrender"
>;

const neutralPerformance: Performance = {
  kills: 2,
  deaths: 2,
  assists: 2,
  pentaKills: 0,
  quadraKills: 0,
  win: true,
  gameEndedInEarlySurrender: false,
};

const exceptionalPerformance: Performance = {
  kills: 12,
  deaths: 1,
  assists: 10,
  pentaKills: 0,
  quadraKills: 0,
  win: true,
  gameEndedInEarlySurrender: false,
};

function buildRawMatch(
  firstPerformance: Performance,
  secondPerformance: Performance,
): RawMatch {
  return RawMatchSchema.parse({
    ...rawMatchFixture,
    info: {
      ...rawMatchFixture.info,
      participants: rawMatchFixture.info.participants.map(
        (participant, index) => {
          if (index === 0) {
            return { ...participant, ...firstPerformance };
          }
          if (index === 1) {
            return { ...participant, ...secondPerformance };
          }
          return participant;
        },
      ),
    },
  });
}

function buildCompletedMatch(
  firstAlias: string,
  secondAlias: string,
  firstPlayerPuuid: typeof firstPuuid = firstPuuid,
) {
  return CompletedMatchSchema.parse({
    queueType: "solo",
    durationInSeconds: 1800,
    players: [
      buildCompletedPlayer(firstAlias, firstPlayerPuuid),
      buildCompletedPlayer(secondAlias, secondPuuid),
    ],
    teams: {
      blue: Array.from({ length: 5 }, (_, index) =>
        buildChampion(`Blue${index.toString()}`),
      ),
      red: Array.from({ length: 5 }, (_, index) =>
        buildChampion(`Red${index.toString()}`),
      ),
    },
  });
}

function buildChampion(riotIdGameName: string) {
  return {
    riotIdGameName,
    championName: "Jinx",
    kills: 2,
    deaths: 2,
    assists: 2,
    level: 18,
    items: [],
    spells: [4, 7],
    gold: 12_000,
    runes: [],
    creepScore: 200,
    visionScore: 30,
    damage: 20_000,
  };
}

function buildCompletedPlayer(alias: string, puuid: typeof firstPuuid) {
  return {
    playerConfig: {
      alias,
      league: {
        leagueAccount: { puuid, region: "AMERICA_NORTH" },
      },
    },
    outcome: "Victory",
    champion: buildChampion(`${alias}#NA1`),
    team: "blue",
    lane: "adc",
  };
}

afterEach(() => {
  mock.restore();
});

function getRequiredDecision(
  firstAlias: string,
  secondAlias: string,
  firstPerformance: Performance,
  secondPerformance: Performance,
) {
  spyOn(Math, "random").mockReturnValue(0);
  const decision = getAiReviewDecision(
    buildCompletedMatch(firstAlias, secondAlias),
    buildRawMatch(firstPerformance, secondPerformance),
  );
  if (decision === undefined) {
    throw new Error("Expected a review decision for the selected player");
  }
  return decision;
}

describe("getAiReviewDecision", () => {
  test("rejects a selected player absent from the raw match", () => {
    spyOn(Math, "random").mockReturnValue(0);

    expect(() =>
      getAiReviewDecision(
        buildCompletedMatch("Selected", "Tracked", mismatchedPuuid),
        buildRawMatch(neutralPerformance, neutralPerformance),
      ),
    ).toThrow(
      `Selected player Selected (${mismatchedPuuid}) is absent from raw match ${rawMatchFixture.metadata.matchId}`,
    );
  });

  test("rejects a neutral selected player when another tracked player is exceptional", () => {
    const decision = getRequiredDecision(
      "Selected",
      "Exceptional",
      neutralPerformance,
      exceptionalPerformance,
    );

    expect(decision.playerIndex).toBe(0);
    expect(decision.selectedPlayer.playerConfig.alias).toBe("Selected");
    expect(decision.exceptionalResult).toEqual({ isExceptional: false });
    expect(decision.jerredOverride).toBe(false);
    expect(decision.shouldGenerateReview).toBe(false);
  });

  test("accepts an exceptional selected player when another tracked player is neutral", () => {
    const decision = getRequiredDecision(
      "Selected",
      "Neutral",
      exceptionalPerformance,
      neutralPerformance,
    );

    expect(decision.playerIndex).toBe(0);
    expect(decision.selectedPlayer.playerConfig.alias).toBe("Selected");
    expect(decision.exceptionalResult).toEqual({
      isExceptional: true,
      reason: "high KDA (22.0)",
    });
    expect(decision.shouldGenerateReview).toBe(true);
  });

  test("selects Jerred and applies his override to a non-exceptional performance", () => {
    const decision = getRequiredDecision(
      "Exceptional",
      "Jerred",
      exceptionalPerformance,
      neutralPerformance,
    );

    expect(decision.playerIndex).toBe(1);
    expect(decision.selectedPlayer.playerConfig.alias).toBe("Jerred");
    expect(decision.exceptionalResult).toEqual({ isExceptional: false });
    expect(decision.jerredOverride).toBe(true);
    expect(decision.shouldGenerateReview).toBe(true);
  });
});
