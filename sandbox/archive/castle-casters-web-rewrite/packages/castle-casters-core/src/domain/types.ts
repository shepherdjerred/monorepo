export const playerIds = ["one", "two", "three", "four"] as const;
export type PlayerId = (typeof playerIds)[number];

export const elements = ["fire", "ice", "earth", "wind"] as const;
export type Element = (typeof elements)[number];

export const gameMapIds = [
  "grass",
  "grassBig",
  "grassSmall",
  "winter",
  "winterBig",
  "winterSmall",
  "desert",
  "desertBig",
  "desertSmall",
  "test",
] as const;
export type GameMapId = (typeof gameMapIds)[number];

export type PlayerCount = 2 | 4;

export type Player = {
  id: PlayerId;
  kind: "human" | "ai";
  name: string;
  element: Element;
};

export function playerIdFromIndex(index: number): PlayerId {
  const playerId = playerIds[index];
  if (playerId === undefined) {
    throw new Error(`Invalid player index: ${String(index)}`);
  }
  return playerId;
}

export function playerIndex(playerId: PlayerId): number {
  return playerIds.indexOf(playerId);
}

export function activePlayers(playerCount: PlayerCount): PlayerId[] {
  return playerIds.slice(0, playerCount);
}
