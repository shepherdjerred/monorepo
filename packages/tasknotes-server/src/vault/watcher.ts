import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

export type WatcherCallback = () => void;

export function watchVault(
  vaultPath: string,
  tasksDir: string,
  callback: WatcherCallback,
): FSWatcher {
  const watchDir = tasksDir === "" ? vaultPath : path.join(vaultPath, tasksDir);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const watcher = watch(watchDir, { recursive: true }, (_event, filename) => {
    if (filename?.endsWith(".md") !== true) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(callback, 200);
  });

  // Without an error listener a watcher failure (dir deleted, fd exhaustion)
  // is an unhandled 'error' event: either a crash with no context or, worse,
  // a dead watcher and a silently stale task store.
  watcher.on("error", (error) => {
    console.error(
      `[vault] WATCHER ERROR on ${watchDir} — task store may be stale until restart: ${String(error)}`,
    );
  });

  return watcher;
}
