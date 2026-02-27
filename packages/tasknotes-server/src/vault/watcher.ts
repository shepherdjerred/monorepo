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

  return watcher;
}
