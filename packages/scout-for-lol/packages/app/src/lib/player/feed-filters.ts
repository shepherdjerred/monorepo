import {
  PLAYER_PROFILE_QUEUE_GROUPS,
  PLAYER_PROFILE_QUEUE_PRESETS,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";

export const GAME_WINDOWS: readonly {
  value: PlayerProfileGameWindow;
  label: string;
}[] = [
  { value: 20, label: "Last 20" },
  { value: 50, label: "Last 50" },
  { value: "all", label: "All time" },
];

const EVERY_QUEUE: readonly QueueType[] = PLAYER_PROFILE_QUEUE_GROUPS.flatMap(
  (group) => group.queues,
);

function sameQueues(
  left: readonly QueueType[],
  right: readonly QueueType[],
): boolean {
  return (
    left.length === right.length && left.every((queue) => right.includes(queue))
  );
}

/** Every queue is in: no queue filter at all. */
export function isAllGames(filters: PlayerProfileFilters): boolean {
  return (
    filters.queues === undefined || sameQueues(filters.queues, EVERY_QUEUE)
  );
}

/** The ranked queues and nothing else: what a visit starts on. */
export function isRankedGames(filters: PlayerProfileFilters): boolean {
  return (
    filters.queues !== undefined &&
    sameQueues(filters.queues, PLAYER_PROFILE_QUEUE_PRESETS.competitive)
  );
}

export function rankedFilters(
  filters: PlayerProfileFilters,
): PlayerProfileFilters {
  return {
    games: filters.games,
    queues: [...PLAYER_PROFILE_QUEUE_PRESETS.competitive],
  };
}

export function allGamesFilters(
  filters: PlayerProfileFilters,
): PlayerProfileFilters {
  return { games: filters.games };
}

/**
 * The queues a toggle leaves selected. The last selected queue cannot be
 * turned off, and selecting every queue is the same as no filter, so a toggle
 * that lands there returns `undefined`.
 */
export function toggleQueue(
  selected: readonly QueueType[] | undefined,
  toggled: QueueType,
): QueueType[] | undefined {
  const current = selected ?? EVERY_QUEUE;
  const next = current.includes(toggled)
    ? current.filter((queue) => queue !== toggled)
    : [...current, toggled];
  if (next.length === 0)
    return selected === undefined ? undefined : [...selected];
  return next.length === EVERY_QUEUE.length ? undefined : next;
}

/** The queues the filters include, whether listed or implied by "all". */
export function includedQueues(
  filters: PlayerProfileFilters,
): readonly QueueType[] {
  return filters.queues ?? EVERY_QUEUE;
}
