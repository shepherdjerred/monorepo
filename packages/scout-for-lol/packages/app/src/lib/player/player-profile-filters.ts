import {
  PLAYER_PROFILE_QUEUE_PRESETS,
  PlayerProfileFilterSchema,
  QueueTypeSchema,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";

export type PlayerProfileFilters = {
  games: PlayerProfileGameWindow;
  queues?: QueueType[];
};

/** Omitted `games` in the profile URL. */
const DEFAULT_GAMES: PlayerProfileGameWindow = "all";
/** Omitted `queue` in the profile URL. */
const DEFAULT_QUEUES: readonly QueueType[] =
  PLAYER_PROFILE_QUEUE_PRESETS.competitive;
/** Explicit "every recorded queue" — absence now means competitive. */
const ALL_QUEUES_SENTINEL = "all";

function defaultPlayerProfileFilters(
  games: PlayerProfileGameWindow,
): PlayerProfileFilters {
  return { games, queues: [...DEFAULT_QUEUES] };
}

function sameQueueSet(
  left: readonly QueueType[],
  right: readonly QueueType[],
): boolean {
  return (
    left.length === right.length && left.every((queue) => right.includes(queue))
  );
}

function queueOrder(order: ReadonlyMap<QueueType, number>, queue: QueueType) {
  const index = order.get(queue);
  if (index === undefined) {
    throw new Error(`Queue ${queue} is missing from the canonical order`);
  }
  return index;
}

export function parsePlayerProfileFilters(
  searchParams: URLSearchParams,
): PlayerProfileFilters {
  const gamesValue = searchParams.get("games");
  const games: PlayerProfileGameWindow =
    gamesValue === "20" ? 20 : gamesValue === "50" ? 50 : DEFAULT_GAMES;
  const rawQueues = searchParams.getAll("queue");
  if (rawQueues.length === 0) {
    return defaultPlayerProfileFilters(games);
  }
  if (rawQueues.length === 1 && rawQueues[0] === ALL_QUEUES_SENTINEL) {
    return { games };
  }
  const queues = rawQueues.map((queue) => QueueTypeSchema.safeParse(queue));
  if (queues.some((queue) => !queue.success)) {
    return defaultPlayerProfileFilters(games);
  }
  const parsed = PlayerProfileFilterSchema.safeParse({
    games,
    queues: queues.map((queue) => {
      if (!queue.success) {
        throw new Error("Invalid queue survived profile filter validation");
      }
      return queue.data;
    }),
  });
  if (!parsed.success) return defaultPlayerProfileFilters(games);
  return {
    games: parsed.data.games,
    ...(parsed.data.queues === undefined ? {} : { queues: parsed.data.queues }),
  };
}

export function playerProfileSearchParams(
  filters: PlayerProfileFilters,
): URLSearchParams {
  const parsed = PlayerProfileFilterSchema.parse(filters);
  const searchParams = new URLSearchParams();
  if (parsed.games !== DEFAULT_GAMES) {
    searchParams.set("games", parsed.games.toString());
  }
  if (parsed.queues === undefined) {
    searchParams.set("queue", ALL_QUEUES_SENTINEL);
  } else if (!sameQueueSet(parsed.queues, DEFAULT_QUEUES)) {
    const order = new Map(
      QueueTypeSchema.options.map((queue, index) => [queue, index] as const),
    );
    for (const queue of parsed.queues.toSorted(
      (left, right) => queueOrder(order, left) - queueOrder(order, right),
    )) {
      searchParams.append("queue", queue);
    }
  }
  return searchParams;
}

export function playerProfileSearch(filters: PlayerProfileFilters): string {
  const query = playerProfileSearchParams(filters).toString();
  return query.length === 0 ? "" : `?${query}`;
}

export function filterKey(filters: PlayerProfileFilters): string {
  return `${filters.games.toString()}:${filters.queues?.join(",") ?? "all"}`;
}
