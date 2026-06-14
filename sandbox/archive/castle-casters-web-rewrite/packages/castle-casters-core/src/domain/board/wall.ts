import { coordinateKey, sameCoordinate, type Coordinate } from "./coordinate.ts";

export type WallOrientation = "horizontal" | "vertical";

export type WallLocation = Readonly<{
  start: Coordinate;
  vertex: Coordinate;
  end: Coordinate;
}>;

export function wallLocation(start: Coordinate, vertex: Coordinate, end: Coordinate): WallLocation {
  return Object.freeze({ start, vertex, end });
}

export function wallOrientation(location: WallLocation): WallOrientation {
  return location.start.y === location.end.y ? "horizontal" : "vertical";
}

export function wallKey(location: WallLocation): string {
  return `${coordinateKey(location.start)}|${coordinateKey(location.vertex)}|${coordinateKey(location.end)}`;
}

export function sameWall(left: WallLocation, right: WallLocation): boolean {
  return (
    sameCoordinate(left.start, right.start) &&
    sameCoordinate(left.vertex, right.vertex) &&
    sameCoordinate(left.end, right.end)
  );
}
