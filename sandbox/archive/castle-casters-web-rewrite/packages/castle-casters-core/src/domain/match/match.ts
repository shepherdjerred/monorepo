import { coordinate, coordinateKey, sameCoordinate, type Coordinate } from "#src/domain/board/coordinate.ts";
import { wallKey, wallLocation, type WallLocation } from "#src/domain/board/wall.ts";
import { activePlayers, playerIdFromIndex, playerIndex, type PlayerCount, type PlayerId } from "#src/domain/types.ts";

export type BoardSettings = {
  boardSize: number;
  playerCount: PlayerCount;
};

export type MatchSettings = {
  wallsPerPlayer: number;
  startingPlayer: PlayerId;
  playerCount: PlayerCount;
  boardSize: number;
};

export type MatchStatus =
  | { type: "inProgress" }
  | { type: "victory"; winner: PlayerId };

export type MatchState = Readonly<{
  settings: MatchSettings;
  activePlayer: PlayerId;
  status: MatchStatus;
  pawns: Record<PlayerId, Coordinate | undefined>;
  walls: WallLocation[];
  wallsRemaining: Record<PlayerId, number>;
  history: Turn[];
  version: number;
}>;

export type NormalMovePawnTurn = Readonly<{
  type: "normalMovePawn";
  playerId: PlayerId;
  source: Coordinate;
  destination: Coordinate;
}>;

export type JumpPawnStraightTurn = Readonly<{
  type: "jumpPawnStraight";
  playerId: PlayerId;
  source: Coordinate;
  pivot: Coordinate;
  destination: Coordinate;
}>;

export type JumpPawnDiagonalTurn = Readonly<{
  type: "jumpPawnDiagonal";
  playerId: PlayerId;
  source: Coordinate;
  pivot: Coordinate;
  destination: Coordinate;
}>;

export type PlaceWallTurn = Readonly<{
  type: "placeWall";
  playerId: PlayerId;
  wall: WallLocation;
}>;

export type MovePawnTurn = NormalMovePawnTurn | JumpPawnStraightTurn | JumpPawnDiagonalTurn;
export type Turn = MovePawnTurn | PlaceWallTurn;

export type TurnValidation = {
  ok: boolean;
  errors: string[];
};

export function standardMatchSettings(playerCount: PlayerCount = 2): MatchSettings {
  return {
    wallsPerPlayer: 10,
    startingPlayer: "one",
    playerCount,
    boardSize: 9,
  };
}

export function createMatch(settings: MatchSettings = standardMatchSettings()): MatchState {
  const pawns = emptyPawnRecord();
  for (const playerId of activePlayers(settings.playerCount)) {
    pawns[playerId] = startingCoordinate(settings.boardSize, playerId);
  }

  const wallsRemaining = emptyWallRecord();
  for (const playerId of activePlayers(settings.playerCount)) {
    wallsRemaining[playerId] = settings.wallsPerPlayer;
  }

  const state: MatchState = {
    settings,
    activePlayer: settings.startingPlayer,
    status: { type: "inProgress" },
    pawns,
    walls: [],
    wallsRemaining,
    history: [],
    version: 0,
  };
  return Object.freeze(state);
}

export function gridSize(boardSize: number): number {
  return boardSize * 2 - 1;
}

export function startingCoordinate(boardSize: number, playerId: PlayerId): Coordinate {
  const max = gridSize(boardSize) - 1;
  const center = boardSize - 1;
  if (playerId === "one") {
    return coordinate(center, 0);
  }
  if (playerId === "two") {
    return coordinate(center, max);
  }
  if (playerId === "three") {
    return coordinate(0, center);
  }
  return coordinate(max, center);
}

export function goalReached(match: MatchState, playerId: PlayerId, destination: Coordinate): boolean {
  return goalCoordinates(match.settings.boardSize, playerId).some((goal) => sameCoordinate(goal, destination));
}

export function goalCoordinates(boardSize: number, playerId: PlayerId): Coordinate[] {
  const max = gridSize(boardSize) - 1;
  const goals: Coordinate[] = [];
  if (playerId === "one") {
    for (let x = 0; x <= max; x += 2) {
      goals.push(coordinate(x, max));
    }
    return goals;
  }
  if (playerId === "two") {
    for (let x = 0; x <= max; x += 2) {
      goals.push(coordinate(x, 0));
    }
    return goals;
  }
  if (playerId === "three") {
    for (let y = 0; y <= max; y += 2) {
      goals.push(coordinate(max, y));
    }
    return goals;
  }
  for (let y = 0; y <= max; y += 2) {
    goals.push(coordinate(0, y));
  }
  return goals;
}

export function nextPlayer(match: MatchState): PlayerId {
  const players = activePlayers(match.settings.playerCount);
  const nextIndex = (playerIndex(match.activePlayer) + 1) % players.length;
  return playerIdFromIndex(nextIndex);
}

export function inactivePlayers(match: MatchState): PlayerId[] {
  return activePlayers(match.settings.playerCount).filter((playerId) => playerId !== match.activePlayer);
}

export function adjacentPawnSpaces(match: MatchState, value: Coordinate, range = 1): Coordinate[] {
  const distance = range * 2;
  const candidates = [
    coordinate(value.x - distance, value.y),
    coordinate(value.x + distance, value.y),
    coordinate(value.x, value.y - distance),
    coordinate(value.x, value.y + distance),
  ];
  return candidates.filter((candidate) => isInBounds(match, candidate));
}

export function getPawn(match: MatchState, playerId: PlayerId): Coordinate {
  const pawn = match.pawns[playerId];
  if (pawn === undefined) {
    throw new Error(`No pawn for player ${playerId}`);
  }
  return pawn;
}

export function hasPawnAt(match: MatchState, value: Coordinate): boolean {
  return activePlayers(match.settings.playerCount).some((playerId) => {
    const pawn = match.pawns[playerId];
    return pawn !== undefined && sameCoordinate(pawn, value);
  });
}

export function isInBounds(match: MatchState, value: Coordinate): boolean {
  const size = gridSize(match.settings.boardSize);
  return value.x >= 0 && value.y >= 0 && value.x < size && value.y < size;
}

export function wallBetween(left: Coordinate, right: Coordinate): Coordinate {
  return coordinate((left.x + right.x) / 2, (left.y + right.y) / 2);
}

export function hasWallAt(match: MatchState, value: Coordinate): boolean {
  return match.walls.some((wall) => {
    return sameCoordinate(wall.start, value) || sameCoordinate(wall.vertex, value) || sameCoordinate(wall.end, value);
  });
}

export function isBlocked(match: MatchState, source: Coordinate, destination: Coordinate): boolean {
  return hasWallAt(match, wallBetween(source, destination));
}

export function canonicalTurnKey(turn: Turn): string {
  if (turn.type === "placeWall") {
    return `${turn.playerId}:${turn.type}:${wallKey(turn.wall)}`;
  }
  if (turn.type === "jumpPawnDiagonal" || turn.type === "jumpPawnStraight") {
    return `${turn.playerId}:${turn.type}:${coordinateKey(turn.source)}:${coordinateKey(turn.pivot)}:${coordinateKey(turn.destination)}`;
  }
  return `${turn.playerId}:${turn.type}:${coordinateKey(turn.source)}:${coordinateKey(turn.destination)}`;
}

export function validateTurn(match: MatchState, turn: Turn): TurnValidation {
  const errors: string[] = [];
  if (match.status.type !== "inProgress") {
    errors.push("Match is not in progress.");
  }
  if (turn.playerId !== match.activePlayer) {
    errors.push("It is not this player's turn.");
  }

  if (turn.type === "placeWall") {
    errors.push(...validateWallTurn(match, turn));
  } else {
    errors.push(...validateMoveTurn(match, turn));
  }

  return { ok: errors.length === 0, errors };
}

export function applyTurn(match: MatchState, turn: Turn): MatchState {
  const validation = validateTurn(match, turn);
  if (!validation.ok) {
    throw new Error(validation.errors.join(" "));
  }

  const pawns: Record<PlayerId, Coordinate | undefined> = { ...match.pawns };
  const wallsRemaining: Record<PlayerId, number> = { ...match.wallsRemaining };
  let walls = match.walls;
  let status: MatchStatus = match.status;

  if (turn.type === "placeWall") {
    walls = [...match.walls, turn.wall];
    wallsRemaining[turn.playerId] = (wallsRemaining[turn.playerId] ?? 0) - 1;
  } else {
    pawns[turn.playerId] = turn.destination;
    if (turn.type === "normalMovePawn" && goalReached(match, turn.playerId, turn.destination)) {
      status = { type: "victory", winner: turn.playerId };
    }
  }

  const nextState: MatchState = {
    settings: match.settings,
    activePlayer: nextPlayer(match),
    status,
    pawns,
    walls,
    wallsRemaining,
    history: [...match.history, turn],
    version: match.version + 1,
  };
  return Object.freeze(nextState);
}

function validateMoveTurn(match: MatchState, turn: MovePawnTurn): string[] {
  const errors: string[] = [];
  const actualSource = getPawn(match, turn.playerId);
  if (!sameCoordinate(actualSource, turn.source)) {
    errors.push("Move source is not the active pawn location.");
  }
  if (!isInBounds(match, turn.destination)) {
    errors.push("Move destination is out of bounds.");
  }
  if (hasPawnAt(match, turn.destination)) {
    errors.push("Move destination is occupied.");
  }
  if (turn.destination.x % 2 !== 0 || turn.destination.y % 2 !== 0) {
    errors.push("Move destination is not a pawn cell.");
  }

  if (turn.type === "normalMovePawn") {
    const distance = Math.abs(turn.source.x - turn.destination.x) + Math.abs(turn.source.y - turn.destination.y);
    if (distance !== 2) {
      errors.push("Normal move must travel one pawn space.");
    }
    if (isBlocked(match, turn.source, turn.destination)) {
      errors.push("Wall blocks normal move.");
    }
  } else {
    if (!hasPawnAt(match, turn.pivot)) {
      errors.push("Jump pivot does not contain a pawn.");
    }
    if (isBlocked(match, turn.source, turn.pivot)) {
      errors.push("Wall blocks jump to pivot.");
    }
    if (turn.type === "jumpPawnStraight") {
      const sourceToPivot = Math.abs(turn.source.x - turn.pivot.x) + Math.abs(turn.source.y - turn.pivot.y);
      const pivotToDestination = Math.abs(turn.pivot.x - turn.destination.x) + Math.abs(turn.pivot.y - turn.destination.y);
      if (sourceToPivot !== 2 || pivotToDestination !== 2) {
        errors.push("Straight jump geometry is invalid.");
      }
      if (isBlocked(match, turn.pivot, turn.destination)) {
        errors.push("Wall blocks straight jump destination.");
      }
    } else {
      const sourceToPivot = Math.abs(turn.source.x - turn.pivot.x) + Math.abs(turn.source.y - turn.pivot.y);
      const pivotToDestination = Math.abs(turn.pivot.x - turn.destination.x) + Math.abs(turn.pivot.y - turn.destination.y);
      const sourceToDestinationIsDiagonal = turn.source.x !== turn.destination.x && turn.source.y !== turn.destination.y;
      if (sourceToPivot !== 2 || pivotToDestination !== 2 || !sourceToDestinationIsDiagonal) {
        errors.push("Diagonal jump geometry is invalid.");
      }
      const behind = coordinate(turn.pivot.x + (turn.pivot.x - turn.source.x), turn.pivot.y + (turn.pivot.y - turn.source.y));
      if (!isInBounds(match, behind) || !isBlocked(match, turn.pivot, behind)) {
        errors.push("Diagonal jump requires a wall behind the pivot.");
      }
    }
  }
  return errors;
}

function validateWallTurn(match: MatchState, turn: PlaceWallTurn): string[] {
  const errors: string[] = [];
  const remaining = match.wallsRemaining[turn.playerId] ?? 0;
  if (remaining <= 0) {
    errors.push("Player has no walls left.");
  }
  const cells = [turn.wall.start, turn.wall.vertex, turn.wall.end];
  if (!cells.every((cell) => isInBounds(match, cell))) {
    errors.push("Wall is out of bounds.");
  }
  if (hasWallAt(match, turn.wall.start) || hasWallAt(match, turn.wall.vertex) || hasWallAt(match, turn.wall.end)) {
    errors.push("Wall overlaps another wall.");
  }
  if (match.walls.some((wall) => wallKey(wall) === wallKey(turn.wall))) {
    errors.push("Wall already exists.");
  }

  const tentative = Object.freeze({ ...match, walls: [...match.walls, turn.wall] });
  for (const playerId of activePlayers(match.settings.playerCount)) {
    if (shortestPath(tentative, playerId) === undefined) {
      errors.push("Wall blocks a pawn from reaching its goal.");
      break;
    }
  }
  return errors;
}

export function generateValidTurns(match: MatchState): Turn[] {
  return generateCandidateTurns(match)
    .filter((turn) => validateTurn(match, turn).ok)
    .toSorted((left, right) => canonicalTurnKey(left).localeCompare(canonicalTurnKey(right)));
}

export function generateCandidateTurns(match: MatchState): Turn[] {
  const playerId = match.activePlayer;
  const source = getPawn(match, playerId);
  const turns: Turn[] = [];
  const directions = [
    [0, -2],
    [2, 0],
    [0, 2],
    [-2, 0],
  ] as const;

  for (const [dx, dy] of directions) {
    const destination = coordinate(source.x + dx, source.y + dy);
    turns.push({ type: "normalMovePawn", playerId, source, destination });
    if (hasPawnAt(match, destination)) {
      turns.push({
        type: "jumpPawnStraight",
        playerId,
        source,
        pivot: destination,
        destination: coordinate(destination.x + dx, destination.y + dy),
      });
      for (const diagonal of diagonalDeltas(dx, dy)) {
        turns.push({
          type: "jumpPawnDiagonal",
          playerId,
          source,
          pivot: destination,
          destination: coordinate(destination.x + diagonal[0], destination.y + diagonal[1]),
        });
      }
    }
  }

  const max = gridSize(match.settings.boardSize) - 1;
  for (let x = 0; x < max; x += 1) {
    for (let y = 0; y < max; y += 1) {
      if (x % 2 !== 0 && y % 2 === 0) {
        turns.push({
          type: "placeWall",
          playerId,
          wall: wallLocation(coordinate(x, y), coordinate(x, y + 1), coordinate(x, y + 2)),
        });
      }
      if (x % 2 === 0 && y % 2 !== 0) {
        turns.push({
          type: "placeWall",
          playerId,
          wall: wallLocation(coordinate(x, y), coordinate(x + 1, y), coordinate(x + 2, y)),
        });
      }
    }
  }

  return turns;
}

function diagonalDeltas(dx: number, _dy: number): (readonly [number, number])[] {
  if (dx !== 0) {
    return [
      [0, -2],
      [0, 2],
    ];
  }
  return [
    [-2, 0],
    [2, 0],
  ];
}

function emptyPawnRecord(): Record<PlayerId, Coordinate | undefined> {
  return {
    one: undefined,
    two: undefined,
    three: undefined,
    four: undefined,
  };
}

function emptyWallRecord(): Record<PlayerId, number> {
  return {
    one: 0,
    two: 0,
    three: 0,
    four: 0,
  };
}

export function shortestPath(match: MatchState, playerId: PlayerId): number | undefined {
  const start = getPawn(match, playerId);
  const queue: { coordinate: Coordinate; distance: number }[] = [{ coordinate: start, distance: 0 }];
  const seen = new Set<string>([coordinateKey(start)]);
  const directions = [
    [0, -2],
    [2, 0],
    [0, 2],
    [-2, 0],
  ] as const;

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) {
      break;
    }
    if (goalReached(match, playerId, item.coordinate)) {
      return item.distance;
    }
    for (const [dx, dy] of directions) {
      const destination = coordinate(item.coordinate.x + dx, item.coordinate.y + dy);
      const key = coordinateKey(destination);
      if (!isInBounds(match, destination) || seen.has(key) || isBlocked(match, item.coordinate, destination)) {
        continue;
      }
      seen.add(key);
      queue.push({ coordinate: destination, distance: item.distance + 1 });
    }
  }

  return undefined;
}
