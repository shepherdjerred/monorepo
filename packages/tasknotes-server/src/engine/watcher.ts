import { watch, type FSWatcher } from "node:fs";

/**
 * Vault file watcher feeding the TaskRepository (review finding #12: the
 * old watcher was trailing-edge-only — a sustained Obsidian Sync burst
 * postponed rescans forever — dropped null filenames, and had no error
 * listener, so an FSWatcher error crashed the process).
 *
 * - Events are debounced 200ms, but a MAX-WAIT of 1s guarantees a flush
 *   even under a continuous event stream.
 * - Changed paths are collected and delivered as a batch for targeted
 *   `refreshFile` calls; a null filename (platform limitation) degrades
 *   that batch to a full-rescan signal instead of being dropped.
 * - Watcher errors re-arm with backoff instead of killing the process.
 * - An interval safety rescan (default 10 min) catches anything a watch
 *   gap missed.
 */

export type WatcherEvents = {
  /** Batched changed vault-relative paths; empty array = full rescan needed. */
  onChanges: (paths: string[]) => void;
  /** Called on watch errors (before the re-arm attempt). */
  onError?: (error: unknown) => void;
};

export type WatcherOptions = {
  debounceMs?: number;
  maxWaitMs?: number;
  safetyRescanMs?: number;
  rearmDelayMs?: number;
};

export type VaultWatcher = {
  close: () => void;
};

export function watchVault(
  vaultPath: string,
  events: WatcherEvents,
  options: WatcherOptions = {},
): VaultWatcher {
  const debounceMs = options.debounceMs ?? 200;
  const maxWaitMs = options.maxWaitMs ?? 1000;
  const safetyRescanMs = options.safetyRescanMs ?? 10 * 60 * 1000;
  const rearmDelayMs = options.rearmDelayMs ?? 1000;

  let watcher: FSWatcher | null = null;
  let closed = false;
  let pending = new Set<string>();
  let needsFullRescan = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (maxWaitTimer !== null) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
    const batch = needsFullRescan ? [] : [...pending];
    pending = new Set();
    needsFullRescan = false;
    events.onChanges(batch);
  }

  function schedule(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
    // The max-wait timer is NOT reset by new events — that's the guarantee.
    maxWaitTimer ??= setTimeout(flush, maxWaitMs);
  }

  function arm(): void {
    if (closed) return;
    try {
      watcher = watch(vaultPath, { recursive: true }, (_event, filename) => {
        if (filename === null) {
          needsFullRescan = true;
          schedule();
          return;
        }
        const relPath = filename.split("\\").join("/");
        if (!relPath.endsWith(".md")) return;
        if (relPath.startsWith(".") || relPath.startsWith("_")) return;
        pending.add(relPath);
        schedule();
      });
      watcher.on("error", (error) => {
        events.onError?.(error);
        watcher?.close();
        watcher = null;
        // The watch itself may have missed events while broken.
        needsFullRescan = true;
        schedule();
        setTimeout(arm, rearmDelayMs);
      });
    } catch (error) {
      events.onError?.(error);
      setTimeout(arm, rearmDelayMs);
    }
  }

  arm();

  const safetyTimer = setInterval(() => {
    needsFullRescan = true;
    flush();
  }, safetyRescanMs);

  return {
    close: () => {
      closed = true;
      clearInterval(safetyTimer);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (maxWaitTimer !== null) clearTimeout(maxWaitTimer);
      watcher?.close();
    },
  };
}
