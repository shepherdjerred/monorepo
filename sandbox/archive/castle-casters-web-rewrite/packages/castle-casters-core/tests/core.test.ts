import { describe, expect, test } from "bun:test";
import {
  adjacentPawnSpaces,
  applyTurn,
  canonicalTurnKey,
  coordinate,
  coordinateToNotation,
  createMatch,
  evaluateAdjacentPawns,
  evaluateDefeat,
  evaluateMatch,
  evaluateOpponentsShortestPath,
  evaluateRemainingWalls,
  evaluateShortestPath,
  evaluateVictory,
  evaluateWallsNearby,
  generateValidTurns,
  goalCoordinates,
  inactivePlayers,
  maxEvaluatorScore,
  minEvaluatorScore,
  notationToTurn,
  shortestPath,
  standardMatchSettings,
  turnToNotation,
  validateTurn,
  wallLocation,
  type EvaluatorWeights,
  type MatchState,
} from "#src/index.ts";

describe("castle-casters core", () => {
  test("creates a standard two-player match", () => {
    const match = createMatch();
    expect(match.activePlayer).toBe("one");
    expect(match.pawns.one).toEqual(coordinate(8, 0));
    expect(match.pawns.two).toEqual(coordinate(8, 16));
    expect(match.wallsRemaining.one).toBe(10);
  });

  test("generates deterministic initial legal turns", () => {
    const turns = generateValidTurns(createMatch());
    expect(turns.length).toBe(131);
    const keys = turns.map(canonicalTurnKey);
    const nextKeys = generateValidTurns(createMatch()).map(canonicalTurnKey);
    expect(keys).toEqual(nextKeys);
  });

  test("applies a normal pawn move", () => {
    const match = createMatch();
    const turn = notationToTurn("one", coordinate(8, 0), "e2");
    const validation = validateTurn(match, turn);
    expect(validation.errors).toEqual([]);
    const next = applyTurn(match, turn);
    expect(next.activePlayer).toBe("two");
    expect(next.pawns.one).toEqual(coordinate(8, 2));
  });

  test("rejects overlapping walls", () => {
    const match = createMatch(standardMatchSettings());
    const first = applyTurn(match, {
      type: "placeWall",
      playerId: "one",
      wall: wallLocation(coordinate(1, 0), coordinate(1, 1), coordinate(1, 2)),
    });
    const validation = validateTurn(first, {
      type: "placeWall",
      playerId: "two",
      wall: wallLocation(coordinate(1, 0), coordinate(1, 1), coordinate(1, 2)),
    });
    expect(validation.ok).toBe(false);
  });

  test("finds a shortest path for each player", () => {
    const match = createMatch();
    expect(shortestPath(match, "one")).toBe(8);
    expect(shortestPath(match, "two")).toBe(8);
  });

  test("matches Java notation conversion for board corners and walls", () => {
    expect(coordinateToNotation(coordinate(0, 0))).toBe("a1");
    expect(coordinateToNotation(coordinate(16, 0))).toBe("i1");
    expect(coordinateToNotation(coordinate(0, 16))).toBe("a9");
    expect(coordinateToNotation(coordinate(16, 16))).toBe("i9");

    expect(notationToTurn("one", coordinate(0, 0), "a1h")).toEqual({
      type: "placeWall",
      playerId: "one",
      wall: wallLocation(coordinate(0, 1), coordinate(1, 1), coordinate(2, 1)),
    });
    expect(notationToTurn("one", coordinate(0, 0), "a1v")).toEqual({
      type: "placeWall",
      playerId: "one",
      wall: wallLocation(coordinate(1, 0), coordinate(1, 1), coordinate(1, 2)),
    });
    expect(
      turnToNotation({
        type: "placeWall",
        playerId: "one",
        wall: wallLocation(coordinate(0, 1), coordinate(1, 1), coordinate(2, 1)),
      }),
    ).toBe("a1h");
    expect(
      turnToNotation({
        type: "placeWall",
        playerId: "one",
        wall: wallLocation(coordinate(1, 0), coordinate(1, 1), coordinate(1, 2)),
      }),
    ).toBe("a1v");
  });

  test("matches Java adjacent pawn space checks at board corners", () => {
    const match = createMatch();
    expect(adjacentPawnSpaces(match, coordinate(0, 0)).toSorted(compareCoordinates)).toEqual([
      coordinate(0, 2),
      coordinate(2, 0),
    ]);
    expect(adjacentPawnSpaces(match, coordinate(16, 0)).toSorted(compareCoordinates)).toEqual([
      coordinate(14, 0),
      coordinate(16, 2),
    ]);
    expect(adjacentPawnSpaces(match, coordinate(0, 16)).toSorted(compareCoordinates)).toEqual([
      coordinate(0, 14),
      coordinate(2, 16),
    ]);
    expect(adjacentPawnSpaces(match, coordinate(16, 16)).toSorted(compareCoordinates)).toEqual([
      coordinate(14, 16),
      coordinate(16, 14),
    ]);
  });

  test("matches Java player goals and active player rotation", () => {
    expect(goalCoordinates(9, "one")).toEqual([
      coordinate(0, 16),
      coordinate(2, 16),
      coordinate(4, 16),
      coordinate(6, 16),
      coordinate(8, 16),
      coordinate(10, 16),
      coordinate(12, 16),
      coordinate(14, 16),
      coordinate(16, 16),
    ]);
    expect(goalCoordinates(9, "two")).toContainEqual(coordinate(8, 0));
    expect(goalCoordinates(9, "three")).toContainEqual(coordinate(16, 8));
    expect(goalCoordinates(9, "four")).toContainEqual(coordinate(0, 8));

    const twoPlayerMatch = createMatch();
    expect(inactivePlayers(twoPlayerMatch)).toEqual(["two"]);
    const fourPlayerMatch = createMatch(standardMatchSettings(4));
    expect(inactivePlayers(fourPlayerMatch)).toEqual(["two", "three", "four"]);
  });

  test("validates Java-style diagonal jump only when a wall is behind the pivot", () => {
    const withoutWall = withPawns(createMatch(), { one: coordinate(8, 8), two: coordinate(8, 10) });
    expect(
      validateTurn(withoutWall, {
        type: "jumpPawnDiagonal",
        playerId: "one",
        source: coordinate(8, 8),
        pivot: coordinate(8, 10),
        destination: coordinate(6, 10),
      }).ok,
    ).toBe(false);

    const withBlockingWall = withPawns(
      {
        ...createMatch(),
        walls: [wallLocation(coordinate(8, 11), coordinate(9, 11), coordinate(10, 11))],
      },
      { one: coordinate(8, 8), two: coordinate(8, 10) },
    );
    expect(
      validateTurn(withBlockingWall, {
        type: "jumpPawnDiagonal",
        playerId: "one",
        source: coordinate(8, 8),
        pivot: coordinate(8, 10),
        destination: coordinate(6, 10),
      }).ok,
    ).toBe(true);
  });

  test("matches Java weighted evaluator rule scores", () => {
    const match = createMatch();
    expect(evaluateShortestPath(match, "one")).toBe(10);
    expect(evaluateOpponentsShortestPath(match, "one")).toBe(64);
    expect(evaluateRemainingWalls(match, "one")).toBe(10);
    expect(evaluateAdjacentPawns(match, "one")).toBe(0);
    expect(evaluateWallsNearby(match, "one")).toBe(0);

    const adjacentPawns = withPawns(match, { one: coordinate(8, 8), two: coordinate(8, 10) });
    expect(evaluateAdjacentPawns(adjacentPawns, "one")).toBe(1);

    const nearbyWall = withPawns(
      {
        ...match,
        walls: [wallLocation(coordinate(8, 1), coordinate(9, 1), coordinate(10, 1))],
      },
      { one: coordinate(8, 0) },
    );
    expect(evaluateWallsNearby(nearbyWall, "one")).toBe(1);

    const victory = Object.freeze({ ...match, status: { type: "victory", winner: "one" } as const });
    expect(evaluateVictory(victory, "one")).toBe(maxEvaluatorScore);
    expect(evaluateDefeat(victory, "two")).toBe(minEvaluatorScore);
  });

  test("matches Java weighted evaluator composition with one-hot weights", () => {
    const match = createMatch();
    expect(evaluateMatch(match, "one", zeroWeights({ shortestPath: 1 }))).toBe(10);
    expect(evaluateMatch(match, "one", zeroWeights({ opponentsShortestPath: 1 }))).toBe(64);
    expect(evaluateMatch(match, "one", zeroWeights({ remainingWalls: 1 }))).toBe(10);
  });

  test("matches Java match status updates after goal moves", () => {
    const nearGoal = withPawns(createMatch(), { one: coordinate(10, 14) });
    const victory = applyTurn(nearGoal, {
      type: "normalMovePawn",
      playerId: "one",
      source: coordinate(10, 14),
      destination: coordinate(10, 16),
    });
    expect(victory.status).toEqual({ type: "victory", winner: "one" });
    expect(victory.activePlayer).toBe("two");

    const jumpToGoal = applyTurn(withPawns(createMatch(), { one: coordinate(8, 12), two: coordinate(8, 14) }), {
      type: "jumpPawnStraight",
      playerId: "one",
      source: coordinate(8, 12),
      pivot: coordinate(8, 14),
      destination: coordinate(8, 16),
    });
    expect(jumpToGoal.status).toEqual({ type: "inProgress" });
    expect(jumpToGoal.activePlayer).toBe("two");
  });
});

function compareCoordinates(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return left.x - right.x || left.y - right.y;
}

function withPawns(match: MatchState, pawns: Partial<MatchState["pawns"]>): MatchState {
  return Object.freeze({
    ...match,
    pawns: {
      ...match.pawns,
      ...pawns,
    },
  });
}

function zeroWeights(overrides: Partial<EvaluatorWeights>): EvaluatorWeights {
  return {
    adjacentPawns: 0,
    opponentsShortestPath: 0,
    remainingWalls: 0,
    shortestPath: 0,
    wallsNearby: 0,
    ...overrides,
  };
}
