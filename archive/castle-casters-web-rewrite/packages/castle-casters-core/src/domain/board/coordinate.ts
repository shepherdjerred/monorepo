export type Coordinate = Readonly<{
  x: number;
  y: number;
}>;

export function coordinate(x: number, y: number): Coordinate {
  return Object.freeze({ x, y });
}

export function coordinateKey(value: Coordinate): string {
  return `${String(value.x)},${String(value.y)}`;
}

export function sameCoordinate(left: Coordinate, right: Coordinate): boolean {
  return left.x === right.x && left.y === right.y;
}

export function translate(value: Coordinate, dx: number, dy: number): Coordinate {
  return coordinate(value.x + dx, value.y + dy);
}

export function cardinalDistance(left: Coordinate, right: Coordinate): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

export function isPawnCell(value: Coordinate): boolean {
  return value.x % 2 === 0 && value.y % 2 === 0;
}

export function isWallCell(value: Coordinate): boolean {
  return (value.x % 2 !== 0 && value.y % 2 === 0) || (value.x % 2 === 0 && value.y % 2 !== 0);
}

export function isVertexCell(value: Coordinate): boolean {
  return value.x % 2 !== 0 && value.y % 2 !== 0;
}
