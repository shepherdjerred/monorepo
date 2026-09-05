import { describe, expect, test } from "vitest";
import {
  DuelCompetitorSchema,
  DuelRulesetV1Schema,
  type DuelCompetitor,
  type DuelTimelineInput,
} from "./duel.ts";
import { evaluateDuelGame } from "./duel-evidence.ts";
import {
  buildDuelStanding,
  createEliminationFirstRound,
  rankRoundRobin,
  resolveDoubleEliminationGrandFinal,
  seedDuelEntrants,
} from "./duel-events.ts";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function competitor(id: string, puuids: string[]): DuelCompetitor {
  return DuelCompetitorSchema.parse({
    id,
    kind: puuids.length === 1 ? "player" : "pair",
    accounts: puuids.map((puuid, index) => ({
      playerId: index + (id === FIRST_ID ? 1 : 10),
      playerAlias: `${id}-${index.toString()}`,
      accountId: index + (id === FIRST_ID ? 100 : 200),
      accountAlias: puuid,
      puuid,
    })),
    teamName: null,
  });
}

function timeline(
  firstPuuids: string[],
  secondPuuids: string[],
): DuelTimelineInput {
  return {
    matchId: "NA1_1",
    completed: true,
    timelineComplete: true,
    participants: [
      ...firstPuuids.map((puuid) => ({ puuid, teamId: 100 })),
      ...secondPuuids.map((puuid) => ({ puuid, teamId: 200 })),
    ],
    kills: [],
    turretKills: [],
    frames: [],
  };
}

describe("duel rules and evidence", () => {
  test("requires a bounded objective", () => {
    expect(
      DuelRulesetV1Schema.safeParse({
        version: 1,
        killTarget: null,
        laneCsTarget: null,
        firstTurret: false,
      }).success,
    ).toBe(false);
    expect(
      DuelRulesetV1Schema.safeParse({
        version: 1,
        killTarget: 11,
        laneCsTarget: null,
        firstTurret: false,
      }).success,
    ).toBe(false);
  });

  test("chooses the earliest configured objective", () => {
    const competitors = [
      competitor(FIRST_ID, ["first"]),
      competitor(SECOND_ID, ["second"]),
    ];
    const input = timeline(["first"], ["second"]);
    input.kills = [
      { timestampMs: 20_000, killerPuuid: "second" },
      { timestampMs: 30_000, killerPuuid: "first" },
    ];
    input.turretKills = [{ timestampMs: 40_000, destroyedTeamId: 200 }];
    const result = evaluateDuelGame(
      { version: 1, killTarget: 1, laneCsTarget: null, firstTurret: true },
      competitors,
      input,
    );
    expect(result).toMatchObject({
      state: "verified",
      winnerCompetitorId: SECOND_ID,
      objective: "kills",
      objectiveTimestampMs: 20_000,
    });
  });

  test("attributes a minion-destroyed turret to the opposing team", () => {
    const competitors = [
      competitor(FIRST_ID, ["first"]),
      competitor(SECOND_ID, ["second"]),
    ];
    const input = timeline(["first"], ["second"]);
    input.turretKills = [{ timestampMs: 40_000, destroyedTeamId: 200 }];

    expect(
      evaluateDuelGame(
        { version: 1, killTarget: null, laneCsTarget: null, firstTurret: true },
        competitors,
        input,
      ),
    ).toMatchObject({
      state: "verified",
      winnerCompetitorId: FIRST_ID,
      objective: "first_turret",
      objectiveTimestampMs: 40_000,
    });
  });

  test("sends simultaneous opposing first-turret events to review", () => {
    const competitors = [
      competitor(FIRST_ID, ["first"]),
      competitor(SECOND_ID, ["second"]),
    ];
    const input = timeline(["first"], ["second"]);
    input.turretKills = [
      { timestampMs: 40_000, destroyedTeamId: 100 },
      { timestampMs: 40_000, destroyedTeamId: 200 },
    ];

    expect(
      evaluateDuelGame(
        { version: 1, killTarget: null, laneCsTarget: null, firstTurret: true },
        competitors,
        input,
      ),
    ).toMatchObject({
      state: "needs_review",
      reason:
        "Opposing competitors crossed objectives at the same recorded time",
    });
  });

  test("sends simultaneous CS crossings and split pairs to review", () => {
    const competitors = [
      competitor(FIRST_ID, ["first-a", "first-b"]),
      competitor(SECOND_ID, ["second-a", "second-b"]),
    ];
    const input = timeline(["first-a", "first-b"], ["second-a", "second-b"]);
    input.frames = [
      {
        timestampMs: 60_000,
        participants: input.participants.map((participant) => ({
          puuid: participant.puuid,
          minionsKilled: 5,
          jungleMinionsKilled: 99,
        })),
      },
    ];
    expect(
      evaluateDuelGame(
        { version: 1, killTarget: null, laneCsTarget: 10, firstTurret: false },
        competitors,
        input,
      ),
    ).toMatchObject({ state: "needs_review" });

    input.participants[1] = { puuid: "first-b", teamId: 200 };
    expect(
      evaluateDuelGame(
        { version: 1, killTarget: 1, laneCsTarget: null, firstTurret: false },
        competitors,
        input,
      ).reason,
    ).toContain("split");
  });
});

describe("duel event structure", () => {
  test("seeds randomly and from rolling records deterministically", () => {
    const entrants = ["a", "b", "c", "d"];
    expect(seedDuelEntrants(entrants, "random", {}, "seed")).toEqual(
      seedDuelEntrants(entrants, "random", {}, "seed"),
    );
    expect(
      seedDuelEntrants(entrants, "rolling_record", { a: 2, b: 9 }, "unused"),
    ).toEqual(["b", "a", "c", "d"]);
  });

  test("assigns deterministic byes to the highest seeds", () => {
    const pairings = createEliminationFirstRound([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(
      pairings
        .map((pairing) => pairing.byeWinnerEntrantId)
        .filter((entrantId) => entrantId !== null),
    ).toEqual(["1", "2"]);
  });

  test("requires a grand-final reset only when the losers finalist wins", () => {
    expect(resolveDoubleEliminationGrandFinal("w", "l", "l", null)).toEqual({
      kind: "reset_required",
    });
    expect(resolveDoubleEliminationGrandFinal("w", "l", "w", null)).toEqual({
      kind: "completed",
      winnerCompetitorId: "w",
    });
    expect(resolveDoubleEliminationGrandFinal("w", "l", "l", "w")).toEqual({
      kind: "completed",
      winnerCompetitorId: "w",
    });
  });

  test("uses head-to-head before game differential and marks unresolved ties", () => {
    const thirdId = "33333333-3333-4333-8333-333333333333";
    const fourthId = "44444444-4444-4444-8444-444444444444";
    const ranked = rankRoundRobin(
      [FIRST_ID, SECOND_ID, thirdId, fourthId],
      [
        {
          firstCompetitorId: FIRST_ID,
          secondCompetitorId: SECOND_ID,
          winnerCompetitorId: FIRST_ID,
          firstGameWins: 2,
          secondGameWins: 1,
        },
        {
          firstCompetitorId: FIRST_ID,
          secondCompetitorId: thirdId,
          winnerCompetitorId: thirdId,
          firstGameWins: 0,
          secondGameWins: 2,
        },
        {
          firstCompetitorId: FIRST_ID,
          secondCompetitorId: fourthId,
          winnerCompetitorId: FIRST_ID,
          firstGameWins: 2,
          secondGameWins: 0,
        },
        {
          firstCompetitorId: SECOND_ID,
          secondCompetitorId: thirdId,
          winnerCompetitorId: SECOND_ID,
          firstGameWins: 2,
          secondGameWins: 0,
        },
        {
          firstCompetitorId: SECOND_ID,
          secondCompetitorId: fourthId,
          winnerCompetitorId: SECOND_ID,
          firstGameWins: 2,
          secondGameWins: 0,
        },
        {
          firstCompetitorId: thirdId,
          secondCompetitorId: fourthId,
          winnerCompetitorId: fourthId,
          firstGameWins: 0,
          secondGameWins: 2,
        },
      ],
    );
    expect(ranked.find((entry) => entry.competitorId === FIRST_ID)?.rank).toBe(
      1,
    );
    expect(ranked.find((entry) => entry.competitorId === SECOND_ID)?.rank).toBe(
      2,
    );
    expect(
      buildDuelStanding({
        competitorId: FIRST_ID,
        gameWins: 4,
        gameLosses: 1,
        seriesWins: 2,
        seriesLosses: 0,
        streak: 3,
      }),
    ).toMatchObject({ placed: true, winRate: 0.8 });
  });
});
