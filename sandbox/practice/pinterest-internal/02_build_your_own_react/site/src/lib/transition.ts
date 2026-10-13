import { clamp, phases } from "#lib/lines.ts";
import type { CodeState } from "#lib/lines.ts";

export function emphasis(
  state: CodeState,
  index: number | undefined,
  column?: number,
): number {
  if (index === undefined) return 0.3;
  if (state.focus.length === 0) return 1;
  const focus = state.focus.find((item) => item.line === index + 1);
  if (focus === undefined) return 0.3;
  if (column === undefined || focus.columns === undefined) return 1;
  return column >= focus.columns[0] && column <= focus.columns[1] ? 1 : 0.3;
}

function staggered(amount: number, stagger: number): number {
  return clamp((amount - stagger) / (1 - stagger));
}

const stagger = (id: number, ids: number[]): number =>
  ids.length < 2 ? 0 : (ids.indexOf(id) / (ids.length - 1)) * 0.3;

export function prepareTransition(from: CodeState, to: CodeState) {
  const aPositions = new Map(from.lines.map((id, index) => [id, index]));
  const bPositions = new Map(to.lines.map((id, index) => [id, index]));
  const removed = from.lines.filter((id) => !bPositions.has(id));
  const added = to.lines.filter((id) => !aPositions.has(id));
  return [...new Set([...from.lines, ...to.lines])].map((id) => {
    const a = aPositions.get(id),
      b = bPositions.get(id);
    return {
      id,
      a,
      b,
      start: a ?? b ?? 0,
      end: b ?? a ?? 0,
      exitStagger: stagger(id, removed),
      enterStagger: stagger(id, added),
      fromBrightness: emphasis(from, a),
      toBrightness: emphasis(to, b),
    };
  });
}

export function sampleTransition(
  prepared: ReturnType<typeof prepareTransition>,
  progress: number,
  lineHeight: number,
) {
  const { exit, move, enter } = phases(progress);
  return prepared.map((line) => {
    const { id, a, b, start, end } = line;
    let opacity = 1,
      x = 0;
    const y = (start + (end - start) * move) * lineHeight;
    if (b === undefined) {
      const amount = staggered(exit, line.exitStagger);
      x = -250 * amount;
      opacity = 1 - amount;
    } else if (a === undefined) {
      const amount = staggered(enter, line.enterStagger);
      x = 250 * (1 - amount);
      opacity = amount;
    }
    const brightness =
      line.fromBrightness +
      (line.toBrightness - line.fromBrightness) * progress;
    return { id, a, b, x, y, opacity, brightness };
  });
}

export function transitionLines(
  from: CodeState,
  to: CodeState,
  progress: number,
  lineHeight = 28,
) {
  return sampleTransition(prepareTransition(from, to), progress, lineHeight);
}
