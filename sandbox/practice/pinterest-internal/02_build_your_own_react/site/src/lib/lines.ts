import { defined } from "#lib/invariant.ts";
/** Ordered LCS preserves distinct occurrences of duplicate lines. */
export function matchLines(
  previous: readonly string[],
  next: readonly string[],
): Map<number, number> {
  const table = Array.from(
    { length: previous.length + 1 },
    () => new Uint16Array(next.length + 1),
  );
  for (let i = previous.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      defined(table[i])[j] =
        previous[i] === next[j]
          ? 1 + defined(defined(table[i + 1])[j + 1])
          : Math.max(
              defined(defined(table[i + 1])[j]),
              defined(defined(table[i])[j + 1]),
            );
    }
  }
  const matches = new Map<number, number>();
  let i = 0,
    j = 0;
  while (i < previous.length && j < next.length) {
    if (previous[i] === next[j]) {
      matches.set(j++, i++);
    } else if (
      defined(defined(table[i + 1])[j]) >= defined(defined(table[i])[j + 1])
    )
      i++;
    else j++;
  }
  return matches;
}

export type Token = { text: string; color: string; start: number };
export type Line = { id: number; text: string; tokens: Token[] };
export type Hover = { start: number; end: number; info: number };
export type CodeState = {
  kind: "code";
  lines: number[];
  focus: { line: number; columns?: [number, number] }[];
  hovers: Record<number, Hover[]>;
};
export type ImageState = { kind: "image"; src: string; alt: string };
export type WaveData = {
  lines: Line[];
  states: (CodeState | ImageState)[];
  hovers: string[];
};

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));
export const ease = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
export function phases(progress: number): {
  exit: number;
  move: number;
  enter: number;
} {
  return {
    exit: clamp(progress / 0.25),
    move: ease(clamp((progress - 0.25) / 0.5)),
    enter: clamp((progress - 0.75) / 0.25),
  };
}
export function spring(
  position: number,
  velocity: number,
  target: number,
  seconds: number,
): { position: number; velocity: number } {
  // Integrate in bounded increments so background tabs cannot destabilize the spring.
  const count = Math.ceil(seconds / (1 / 120));
  const dt = seconds / Math.max(count, 1);
  for (let i = 0; i < count; i++) {
    velocity += ((80 * (target - position) - 48 * velocity) / 8) * dt;
    position += velocity * dt;
  }
  return Math.abs(position - target) < 0.001 && Math.abs(velocity) < 0.001
    ? { position: target, velocity: 0 }
    : { position, velocity };
}
