export const left = ["left", "l"] as const;
type Left = (typeof left)[number];
export function isLeft(input: string): boolean {
  return (left as readonly string[]).includes(input);
}

export const right = ["right", "r"] as const;
type Right = (typeof right)[number];
export function isRight(input: string): boolean {
  return (right as readonly string[]).includes(input);
}

export const up = ["up", "u"] as const;
type Up = (typeof up)[number];
export function isUp(input: string): boolean {
  return (up as readonly string[]).includes(input);
}

export const down = ["down", "d"] as const;
type Down = (typeof down)[number];
export function isDown(input: string): boolean {
  return (down as readonly string[]).includes(input);
}

export const a = ["a"] as const;
type A = (typeof a)[number];
export function isA(input: string): boolean {
  return (a as readonly string[]).includes(input);
}

export const b = ["b"] as const;
type B = (typeof b)[number];
export function isB(input: string): boolean {
  return (b as readonly string[]).includes(input);
}

export const select = ["select", "se", "sel"] as const;
type Select = (typeof select)[number];
export function isSelect(input: string): boolean {
  return (select as readonly string[]).includes(input);
}

export const start = ["start", "st"] as const;
type Start = (typeof start)[number];
export function isStart(input: string): boolean {
  return (start as readonly string[]).includes(input);
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
  return (command as readonly string[]).includes(input.toLowerCase());
}
