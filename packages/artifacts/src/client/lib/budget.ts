import type { ArtifactKind } from "@shepherdjerred/artifacts/contract";

/** At most this many frames on a board render their content at once. */
export const LIVE_FRAME_BUDGET = 6;

export type BudgetFrame = { readonly id: string; readonly kind: ArtifactKind };

/**
 * Which frames render live. A frame the reviewer asked to load comes first,
 * most recent first, then the board's own order fills what is left. A `file`
 * has nothing to render, so it never uses the budget.
 */
export function selectLiveFrames(
  frames: readonly BudgetFrame[],
  loaded: readonly string[],
  budget = LIVE_FRAME_BUDGET,
): ReadonlySet<string> {
  const renderable = frames.filter((frame) => frame.kind !== "file");
  const known = new Set(renderable.map((frame) => frame.id));
  const asked = [...loaded].reverse().filter((id) => known.has(id));
  const rest = renderable
    .map((frame) => frame.id)
    .filter((id) => !asked.includes(id));
  return new Set([...asked, ...rest].slice(0, Math.max(0, budget)));
}
