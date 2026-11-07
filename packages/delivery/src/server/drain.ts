/**
 * The API's own rollout replaces the pod that executors and the hub read
 * through (D8). Kubernetes takes a terminating pod's endpoint out of the
 * Service when it sends SIGTERM, but proxies apply that a moment later, so a
 * pod that stops listening at once refuses requests still routed to it.
 * A draining pod reports itself unready and keeps serving until it has
 * affirmative evidence that routing moved: its endpoint is no longer ready
 * and another endpoint is (`unrouted`). Only then does a quiet window, in
 * which no request the app serves arrives, cover the last proxies applying
 * the change. Probes and scrapes keep arriving regardless, so they are not
 * counted. Without that evidence the pod drains until the bound.
 */
const UNTRACKED_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

export type Drain = {
  readonly draining: () => boolean;
  /** Records a request's arrival; call it for every request the API serves. */
  readonly observe: (request: Request) => void;
  /** Starts draining and resolves once routing has provably moved away. */
  readonly untilDrained: () => Promise<void>;
};

export type DrainOptions = {
  /** Resolves true once proxies no longer route new requests to this pod. */
  readonly unrouted?: () => Promise<boolean>;
  /** After `unrouted`, how long no request may arrive before stopping. */
  readonly quietMs?: number;
  /** How often to ask `unrouted` while it is still false. */
  readonly pollMs?: number;
  /** The drain ends here even without evidence. */
  readonly maxMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

export const DRAIN_QUIET_MS = 2000;
export const DRAIN_POLL_MS = 500;
/** Below the Deployment's termination grace period, which also covers stop. */
export const DRAIN_MAX_MS = 25_000;

async function settled(unrouted: (() => Promise<boolean>) | undefined) {
  if (unrouted === undefined) return false;
  try {
    return await unrouted();
  } catch {
    return false;
  }
}

export function createDrain({
  unrouted,
  quietMs = DRAIN_QUIET_MS,
  pollMs = DRAIN_POLL_MS,
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
    untilDrained: async () => {
      draining = true;
      const start = now();
      let movedAt: number | undefined;
      for (;;) {
        const elapsed = now() - start;
        if (elapsed >= maxMs) return;
        if (movedAt === undefined && (await settled(unrouted))) movedAt = now();
        const remaining = maxMs - (now() - start);
        if (movedAt === undefined) {
          await sleep(Math.min(pollMs, remaining));
          continue;
        }
        const quietFor = now() - Math.max(lastArrival, movedAt);
        if (quietFor >= quietMs) return;
        await sleep(Math.min(quietMs - quietFor, remaining));
      }
    },
  };
}
