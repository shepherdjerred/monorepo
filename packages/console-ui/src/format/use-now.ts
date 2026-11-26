import { useSyncExternalStore } from "react";

/** How often the shared clock ticks. */
export const NOW_INTERVAL_MS = 30_000;

export type NowStore = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => number;
};

export type NowStoreEnvironment = {
  readonly clock: () => number;
  /** `true` while the tab is hidden; the clock stops ticking then. */
  readonly hidden: () => boolean;
  /** Calls back when the tab is shown or hidden; returns the unsubscribe. */
  readonly onVisibilityChange: (callback: () => void) => () => void;
};

const noop = (): void => {
  // Nothing to unsubscribe from outside a browser.
};

const browserEnvironment: NowStoreEnvironment = {
  clock: () => Date.now(),
  hidden: () => typeof document !== "undefined" && document.hidden,
  onVisibilityChange: (callback) => {
    if (typeof document === "undefined") return noop;
    document.addEventListener("visibilitychange", callback);
    return () => {
      document.removeEventListener("visibilitychange", callback);
    };
  },
};

/**
 * One interval shared by every relative time on the page. It runs only
 * while something is subscribed and the tab is visible, and catches up the
 * moment the tab is shown again.
 */
export function createNowStore(
  environment: NowStoreEnvironment = browserEnvironment,
  intervalMs: number = NOW_INTERVAL_MS,
): NowStore {
  const listeners = new Set<() => void>();
  let current = environment.clock();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopVisibility: (() => void) | undefined;

  const publish = (): void => {
    current = environment.clock();
    for (const listener of listeners) listener();
  };
  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const sync = (): void => {
    if (listeners.size === 0 || environment.hidden()) {
      stopTimer();
      return;
    }
    if (timer === undefined) {
      publish();
      timer = setInterval(publish, intervalMs);
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        stopVisibility = environment.onVisibilityChange(sync);
      }
      sync();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopVisibility?.();
          stopVisibility = undefined;
          stopTimer();
        }
      };
    },
    getSnapshot: () => current,
  };
}

const sharedNow = createNowStore();

/** The current time in epoch milliseconds, refreshed every 30 seconds. */
export function useNow(): number {
  return useSyncExternalStore(
    sharedNow.subscribe,
    sharedNow.getSnapshot,
    sharedNow.getSnapshot,
  );
}
