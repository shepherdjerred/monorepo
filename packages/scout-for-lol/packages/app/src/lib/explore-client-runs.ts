import type { ExploreActiveRun } from "@scout-for-lol/data";
import type { ExplorePendingTurn } from "#src/lib/explore-turn-state.ts";

export type ExploreClientRun = {
  summary: ExploreActiveRun | null;
  turn: ExplorePendingTurn;
};

export function setExploreClientRun(
  current: Map<string, ExploreClientRun>,
  key: string,
  run: ExploreClientRun,
): Map<string, ExploreClientRun> {
  const next = new Map(current);
  next.set(key, run);
  return next;
}

export function removeExploreClientRun(
  current: Map<string, ExploreClientRun>,
  key: string,
): Map<string, ExploreClientRun> {
  const next = new Map(current);
  next.delete(key);
  return next;
}

export function moveExploreClientRun(
  current: Map<string, ExploreClientRun>,
  fromKey: string,
  toKey: string,
  run: ExploreClientRun,
): Map<string, ExploreClientRun> {
  const next = new Map(current);
  next.delete(fromKey);
  next.set(toKey, run);
  return next;
}

export function clearExploreClientError(
  current: Map<string, string>,
  conversationId: string,
): Map<string, string> {
  if (!current.has(conversationId)) return current;
  const next = new Map(current);
  next.delete(conversationId);
  return next;
}
