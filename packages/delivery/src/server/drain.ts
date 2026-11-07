/**
 * The API's own rollout replaces the pod that executors and the hub are
 * reading through (D8). Kubernetes removes a terminating pod from the
 * Service's endpoints at the same moment it sends SIGTERM, but proxies learn
 * of the removal a moment later, so a pod that stops listening at once
 * refuses the requests still routed to it. A draining pod reports itself
 * unready and keeps serving until requests stop arriving, which is the
 * evidence that the endpoint change has reached every proxy. Probes and
 * scrapes keep arriving regardless, so they are not that evidence.
 */
const UNTRACKED_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

export type Drain = {
  readonly draining: () => boolean;
  /** Records a request's arrival; call it for every request the API serves. */
  readonly observe: (request: Request) => void;
  /** Starts draining and resolves once requests have stopped arriving. */
  readonly untilQuiet: () => Promise<void>;
};

export type DrainOptions = {
  /** How long no request may arrive before the pod counts as unrouted. */
  readonly quietMs?: number;
  /** The drain ends here even if requests still arrive. */
  readonly maxMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

export const DRAIN_QUIET_MS = 2000;
/** Below the Deployment's termination grace period, which also covers stop. */
export const DRAIN_MAX_MS = 25_000;

export function createDrain({
  quietMs = DRAIN_QUIET_MS,
  maxMs = DRAIN_MAX_MS,
  now = Date.now,
  sleep = async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
}: DrainOptions = {}): Drain {
  let draining = false;
  let lastArrival = Number.NEGATIVE_INFINITY;
  return {
    draining: () => draining,
    observe: (request) => {
      if (!UNTRACKED_PATHS.has(new URL(request.url).pathname))
        lastArrival = now();
    },
    untilQuiet: async () => {
      draining = true;
      const start = now();
      // Requests already in flight to this pod count from the signal on.
      lastArrival = Math.max(lastArrival, start);
      for (;;) {
        const current = now();
        const quietFor = current - lastArrival;
        const elapsed = current - start;
        if (quietFor >= quietMs || elapsed >= maxMs) return;
        await sleep(Math.min(quietMs - quietFor, maxMs - elapsed));
      }
    },
  };
}
