import {
  PlayerProfileFilterSchema,
  QueueTypeSchema,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";

export type PlayerProfileFilters = {
  games: PlayerProfileGameWindow;
  queues?: QueueType[];
};

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
    gamesValue === "50" ? 50 : gamesValue === "all" ? "all" : 20;
  const rawQueues = searchParams.getAll("queue");
  if (rawQueues.length === 0) return { games };
  const queues = rawQueues.map((queue) => QueueTypeSchema.safeParse(queue));
  if (queues.some((queue) => !queue.success)) return { games };
  const parsed = PlayerProfileFilterSchema.safeParse({
    games,
    queues: queues.map((queue) => {
      if (!queue.success) {
        throw new Error("Invalid queue survived profile filter validation");
      }
      return queue.data;
    }),
  });
  if (!parsed.success) return { games };
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
  if (parsed.games !== 20) {
    searchParams.set("games", parsed.games.toString());
  }
  if (parsed.queues !== undefined) {
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
