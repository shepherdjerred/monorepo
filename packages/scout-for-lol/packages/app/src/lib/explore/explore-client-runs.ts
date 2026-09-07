import type { ExploreActiveRun } from "@scout-for-lol/data";
import type { ExplorePendingTurn } from "#src/lib/explore/explore-turn-state.ts";

export type ExploreClientRun = {
  summary: ExploreActiveRun | null;
  turn: ExplorePendingTurn;
};

/** Map key for a turn that started on `/explore` before the conversation id exists. */
export const NEW_CONVERSATION_KEY = "new";

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

/**
 * Place a newly started run under its conversation id without dropping the
 * blank `/explore` alias until that route is on screen.
 *
 * `startTurn` learns the id before `navigate` replaces `/explore`. If the
 * alias is deleted in that window, the empty-state copy remounts for a frame.
 */
export function placeStartedExploreRun(input: {
  current: Map<string, ExploreClientRun>;
  fromKey: string;
  conversationId: string;
  run: ExploreClientRun;
  displayedConversationId: string | null;
}): Map<string, ExploreClientRun> {
  const next = setExploreClientRun(
    input.current,
    input.conversationId,
    input.run,
  );
  if (input.fromKey === input.conversationId) {
    return next;
  }
  if (input.displayedConversationId === input.conversationId) {
    return removeExploreClientRun(next, input.fromKey);
  }
  return setExploreClientRun(next, input.fromKey, input.run);
}

export function dropNewConversationAlias(
  current: Map<string, ExploreClientRun>,
  displayedConversationId: string | null,
): Map<string, ExploreClientRun> {
  if (displayedConversationId === null) {
    return current;
  }
  const alias = current.get(NEW_CONVERSATION_KEY);
  if (alias === undefined) {
    return current;
  }
  const aliasConversationId =
    alias.summary?.conversationId ?? alias.turn.conversationId;
  if (aliasConversationId !== displayedConversationId) {
    return current;
  }
  return removeExploreClientRun(current, NEW_CONVERSATION_KEY);
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

export function shouldReconcileMissingExploreRun(input: {
  runId: string;
  discoveredRunIds: ReadonlySet<string>;
  observedRunIds: ReadonlySet<string>;
}): boolean {
  return (
    !input.discoveredRunIds.has(input.runId) &&
    !input.observedRunIds.has(input.runId)
  );
}
