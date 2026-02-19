/** Type-safe check if a readonly tuple includes a string value */
function includesValue(arr: readonly string[], value: string): boolean {
  return arr.includes(value);
}

export const left = ["left", "l"] as const;
type Left = (typeof left)[number];
export function isLeft(input: string): boolean {
  return includesValue(left, input);
}

export const right = ["right", "r"] as const;
type Right = (typeof right)[number];
export function isRight(input: string): boolean {
  return includesValue(right, input);
}

export const up = ["up", "u"] as const;
type Up = (typeof up)[number];
export function isUp(input: string): boolean {
  return includesValue(up, input);
}

export const down = ["down", "d"] as const;
type Down = (typeof down)[number];
export function isDown(input: string): boolean {
  return includesValue(down, input);
}

export const a = ["a"] as const;
type A = (typeof a)[number];
export function isA(input: string): boolean {
  return includesValue(a, input);
}

export const b = ["b"] as const;
type B = (typeof b)[number];
export function isB(input: string): boolean {
  return includesValue(b, input);
}

export const select = ["select", "se", "sel"] as const;
type Select = (typeof select)[number];
export function isSelect(input: string): boolean {
  return includesValue(select, input);
}

export const start = ["start", "st"] as const;
type Start = (typeof start)[number];
export function isStart(input: string): boolean {
  return includesValue(start, input);
}

export const command = [
  ...left,
  ...right,
  ...up,
  ...down,
  ...a,
  ...b,
  ...select,
  ...start,
] as const;
export type Command = Left | Right | Up | Down | A | B | Select | Start;
export function isCommand(input: string): boolean {
  return includesValue(command, input.toLowerCase());
}
