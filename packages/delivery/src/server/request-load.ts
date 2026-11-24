/** A request slower than this is logged when it ends. */
export const SLOW_REQUEST_MS = 3000;

/** Resident memory at which the server starts naming what is in flight. */
export const MEMORY_PRESSURE_BYTES = 450 * 1024 * 1024;

/** How often the memory watch looks. */
export const MEMORY_WATCH_MS = 5000;

const ID_SEGMENT =
  /\/(?:[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{7,64}|\d+)(?=\/|$)/giu;

/** A path with its identifiers collapsed, so requests group by what they ask for. */
export function routeShape(method: string, path: string) {
  const [pathname = ""] = path.split("?");
  return `${method} ${pathname.replaceAll(ID_SEGMENT, "/:id")}`;
}

type Log = (line: string) => void;

/**
 * What the API is serving right now and what has been slow. The Delivery pod
 * was OOM-killed under bursts nothing in its logs explained (FM-184): this
 * names the requests in flight when memory climbs, and every request that
 * took long, by route shape only: never a query string, identifier or body.
 */
export function createRequestLoad(
  options: {
    log?: Log;
    now?: () => number;
    slowMs?: number;
  } = {},
) {
  const log =
    options.log ??
    ((line: string) => {
      console.warn(line);
    });
  const now = options.now ?? (() => performance.now());
  const slowMs = options.slowMs ?? SLOW_REQUEST_MS;
  const inFlight = new Map<string, number>();

  /** The routes in flight, busiest first. */
  function snapshot(limit = 10) {
    return [...inFlight]
      .toSorted((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([route, count]) => ({ route, count }));
  }

  return {
    /** Wrap one request: count it while it runs and log it when it ran long. */
    async track<T>(method: string, path: string, run: () => Promise<T>) {
      const shape = routeShape(method, path);
      inFlight.set(shape, (inFlight.get(shape) ?? 0) + 1);
      const started = now();
      try {
        return await run();
      } finally {
        const remaining = (inFlight.get(shape) ?? 1) - 1;
        if (remaining <= 0) inFlight.delete(shape);
        else inFlight.set(shape, remaining);
        const elapsed = Math.round(now() - started);
        if (elapsed >= slowMs)
          log(
            JSON.stringify({
              message: "delivery_slow_request",
              route: shape,
              ms: elapsed,
              inFlight: total(inFlight),
            }),
          );
      }
    },
    snapshot,
    /** Log the in-flight routes when resident memory is at or above the limit. */
    watchMemory(
      memory: () => { rss: number; heapUsed: number },
      limit = MEMORY_PRESSURE_BYTES,
    ) {
      const { rss, heapUsed } = memory();
      if (rss < limit) return false;
      log(
        JSON.stringify({
          message: "delivery_memory_pressure",
          rssMb: Math.round(rss / 1024 / 1024),
          heapMb: Math.round(heapUsed / 1024 / 1024),
          inFlight: snapshot(),
        }),
      );
      return true;
    },
  };
}

/**
 * Run one request under the load tracker. The change feed streams until the
 * browser leaves, so it is never counted and never slow.
 */
export async function trackRequest(
  load: RequestLoad | undefined,
  method: string,
  path: string,
  next: () => Promise<void>,
) {
  if (load === undefined || path === "/api/v1/events") await next();
  else await load.track(method, path, next);
}

function total(map: ReadonlyMap<string, number>) {
  let sum = 0;
  for (const count of map.values()) sum += count;
  return sum;
}

export type RequestLoad = ReturnType<typeof createRequestLoad>;
