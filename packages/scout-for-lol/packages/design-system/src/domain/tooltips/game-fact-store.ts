import type {
  GameFact,
  GameFactKind,
} from "@scout-for-lol/data/game-facts/schema.ts";

/**
 * How the tooltips fetch one fact. `loadGameFact` from
 * `@scout-for-lol/data/game-facts/client.ts` has this shape.
 */
export type GameFactLoader = (
  kind: GameFactKind,
  key: string,
  options: { signal: AbortSignal },
) => Promise<GameFact>;

/** One caller's hold on a load; release it when the result is not wanted. */
export type GameFactHandle = {
  promise: Promise<GameFact>;
  release: () => void;
};

type Inflight = {
  controller: AbortController;
  promise: Promise<GameFact>;
  holders: number;
};

export type GameFactStore = {
  /** The cached fact, if a load already finished. */
  peek: (kind: GameFactKind, key: string) => GameFact | undefined;
  /**
   * Start, or join, the load of one fact. The request is aborted once every
   * holder has released it before it settled. A finished load stays cached for
   * the life of the store; a failed one is not remembered, so the next hover
   * retries.
   */
  load: (kind: GameFactKind, key: string) => GameFactHandle;
};

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

const cacheKey = (kind: GameFactKind, key: string): string => `${kind}/${key}`;

function release(): void {
  // A cached result holds nothing.
}

/** Marks a rejection as seen; each holder still gets it on its own chain. */
async function observe(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Holders handle their own rejection. This keeps an aborted prefetch that
    // nobody awaits from surfacing as an unhandled rejection.
  }
}

export function createGameFactStore(loader: GameFactLoader): GameFactStore {
  const cache = new Map<string, GameFact>();
  const inflight = new Map<string, Inflight>();

  async function run(
    kind: GameFactKind,
    key: string,
    controller: AbortController,
  ): Promise<GameFact> {
    const id = cacheKey(kind, key);
    try {
      const fact = await loader(kind, key, { signal: controller.signal });
      cache.set(id, fact);
      return fact;
    } finally {
      if (inflight.get(id)?.controller === controller) inflight.delete(id);
    }
  }

  return {
    peek: (kind, key) => cache.get(cacheKey(kind, key)),
    load: (kind, key) => {
      const id = cacheKey(kind, key);
      const cached = cache.get(id);
      if (cached !== undefined) {
        return { promise: Promise.resolve(cached), release };
      }

      let entry = inflight.get(id);
      if (entry === undefined) {
        const controller = new AbortController();
        const promise = run(kind, key, controller);
        void observe(promise);
        entry = { controller, holders: 0, promise };
        inflight.set(id, entry);
      }

      const held = entry;
      held.holders += 1;
      let released = false;
      return {
        promise: held.promise,
        release: () => {
          if (released) return;
          released = true;
          held.holders -= 1;
          if (held.holders === 0 && inflight.get(id) === held) {
            inflight.delete(id);
            held.controller.abort();
          }
        },
      };
    },
  };
}
