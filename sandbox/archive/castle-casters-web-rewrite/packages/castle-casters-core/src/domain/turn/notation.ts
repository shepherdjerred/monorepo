import { coordinate, type Coordinate } from "#src/domain/board/coordinate.ts";
import { wallLocation } from "#src/domain/board/wall.ts";
import type { NormalMovePawnTurn, PlaceWallTurn, Turn } from "#src/domain/match/match.ts";
import type { PlayerId } from "#src/domain/types.ts";

const letters = "abcdefghi";

export function coordinateToNotation(coordinateValue: Coordinate): string {
  const file = letters[coordinateValue.x / 2];
  if (file === undefined) {
    throw new Error(`Coordinate is outside notation board: ${String(coordinateValue.x)},${String(coordinateValue.y)}`);
  }
  return `${file}${String(coordinateValue.y / 2 + 1)}`;
}

export function notationToCoordinate(value: string): Coordinate {
  const file = letters.indexOf(value[0] ?? "");
  const rank = Number(value.slice(1));
  if (file === -1 || !Number.isInteger(rank)) {
    throw new Error(`Invalid notation coordinate: ${value}`);
  }
  return coordinate(file * 2, (rank - 1) * 2);
}

export function turnToNotation(turn: Turn): string {
  if (turn.type === "normalMovePawn") {
    return coordinateToNotation(turn.destination);
  }
  if (turn.type === "placeWall") {
    const suffix = turn.wall.start.y === turn.wall.end.y ? "h" : "v";
    const lowerLeftPawnSpace = coordinate(turn.wall.vertex.x - 1, turn.wall.vertex.y - 1);
    return `${coordinateToNotation(lowerLeftPawnSpace)}${suffix}`;
  }
  return coordinateToNotation(turn.destination);
}

export function notationToTurn(playerId: PlayerId, source: Coordinate, notation: string): NormalMovePawnTurn | PlaceWallTurn {
  const suffix = notation.at(-1);
  if (suffix === "h" || suffix === "v") {
    const lowerLeftPawnSpace = notationToCoordinate(notation.slice(0, -1));
    const wall =
      suffix === "h"
        ? wallLocation(
            coordinate(lowerLeftPawnSpace.x, lowerLeftPawnSpace.y + 1),
            coordinate(lowerLeftPawnSpace.x + 1, lowerLeftPawnSpace.y + 1),
            coordinate(lowerLeftPawnSpace.x + 2, lowerLeftPawnSpace.y + 1),
          )
        : wallLocation(
            coordinate(lowerLeftPawnSpace.x + 1, lowerLeftPawnSpace.y),
            coordinate(lowerLeftPawnSpace.x + 1, lowerLeftPawnSpace.y + 1),
            coordinate(lowerLeftPawnSpace.x + 1, lowerLeftPawnSpace.y + 2),
          );
    return { type: "placeWall", playerId, wall };
  }
  return {
    type: "normalMovePawn",
    playerId,
    source,
    destination: notationToCoordinate(notation),
  };
}
