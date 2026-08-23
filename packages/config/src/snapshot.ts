import type {
  ConfigKeyDefinition,
  ConfigValue,
} from "@shepherdjerred/config/definition.ts";
import type { Resolver } from "@shepherdjerred/config/resolver.ts";

/**
 * A synchronously-readable view of resolved config, refreshed in the
 * background.
 *
 * ## Why this exists
 *
 * Resolution is async because the flag layer is. Plenty of real call sites
 * cannot be: scout hands `exploreAllowlist` to Discord command registration as
 * a `() => string[]`, and `assertWithinBudget()` runs before every model
 * generation. Making those async ripples through registration loops and money
 * paths for what is, at bottom, a cached value.
 *
 * ## The safety property
 *
 * The snapshot is **seeded synchronously at construction** with the values the
 * service uses today, so a read before the first refresh returns exactly what
 * it would have returned before this package existed. It is never empty and
 * never `undefined`.
 *
 * That matters most where a wrong answer is destructive. Scout's allowlist
 * feeds guild command registration: an empty array there does not merely
 * disable a feature, it *unregisters* `/scout` in every guild. Seeding removes
 * the window in which that could happen, and a failed refresh keeps the last
 * good value rather than reverting.
 */
export type SnapshotValues<D extends Record<string, ConfigKeyDefinition>> = {
  readonly [K in keyof D & string]?: ConfigValue<D[K]>;
};

export type ConfigSnapshot<D extends Record<string, ConfigKeyDefinition>> = {
  /** Synchronous read of the last successfully refreshed value. */
  get: <K extends keyof D & string>(key: K) => ConfigValue<D[K]>;
  /** Pulls every tracked key through the resolver. Never throws. */
  refresh: () => Promise<void>;
  /** Begins periodic refresh. Idempotent. */
  start: (intervalMs: number) => void;
  /** Stops the timer. Required, or the process will not exit cleanly. */
  stop: () => void;
};

export type SnapshotOptions<D extends Record<string, ConfigKeyDefinition>> = {
  readonly resolver: Resolver<D>;
  /**
   * The keys to track and their current values.
   *
   * Supplying values rather than reading them lazily is what guarantees a
   * pre-refresh read is safe: the caller passes what the service uses today.
   */
  readonly seed: SnapshotValues<D>;
  /** Reported per key when a refresh fails; the previous value is kept. */
  readonly onRefreshError?: (key: string, message: string) => void;
};

export function createConfigSnapshot<
  D extends Record<string, ConfigKeyDefinition>,
>(options: SnapshotOptions<D>): ConfigSnapshot<D> {
  // Mutable copy of the seed. Typed per key, so reads narrow without an
  // assertion once the `undefined` case is handled.
  const values: { [K in keyof D & string]?: ConfigValue<D[K]> } = {
    ...options.seed,
  };
  // `Object.keys` of the seed IS the tracked set; the seed's own type already
  // constrains its keys to the definition, so no narrowing predicate is needed.
  const trackedKeys: (keyof D & string)[] = [];
  for (const key in options.seed) {
    trackedKeys.push(key);
  }
  let timer: ReturnType<typeof setInterval> | undefined;

  async function refresh(): Promise<void> {
    for (const key of trackedKeys) {
      try {
        const resolved = await options.resolver.get(key);
        values[key] = resolved.value;
      } catch (error) {
        // Keep the previous value. Reverting to a default on a transient
        // failure is the destructive direction — for an allowlist it would
        // empty the list and revoke access.
        const message = error instanceof Error ? error.message : String(error);
        options.onRefreshError?.(key, message);
      }
    }
  }

  return {
    get: (key) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(
          `config snapshot has no seed for "${key}"; add it to the seed so a pre-refresh read is safe`,
        );
      }
      return value;
    },
    refresh,
    start: (intervalMs: number) => {
      timer ??= setInterval(() => {
        void refresh();
      }, intervalMs);
      // Do not hold the event loop open; a config poller should never be the
      // reason a process refuses to exit.
      timer.unref();
    },
    stop: () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
