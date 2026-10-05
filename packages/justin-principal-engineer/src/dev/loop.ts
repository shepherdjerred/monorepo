import { Glob } from "bun";
import path from "node:path";

export async function sourceSnapshot(
  directory: string,
  read: (file: string) => Promise<ArrayBuffer> = (file) =>
    Bun.file(file).arrayBuffer(),
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const file of new Glob("**/*.ts").scanSync({
    cwd: directory,
    absolute: true,
  })) {
    try {
      files.set(file, Bun.hash(await read(file)).toString(16));
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  return files;
}

/** Reload by starting a fresh child between turns, never by killing a turn. */
export async function runDevLoop(input: {
  watchPath: string;
  intervalMs: number;
  signal: AbortSignal;
  turn: () => Promise<number>;
  log: (message: string) => void;
}): Promise<void> {
  let revision = 0;
  let wake: (() => void) | undefined;
  const failures: Error[] = [];
  // Content snapshots catch atomic saves and edits made before macOS delivers
  // its first filesystem event. This timer only supervises the dev process.
  let snapshot = await sourceSnapshot(input.watchPath);
  let scanning = false;
  const watcher = setInterval(() => {
    if (scanning) return;
    scanning = true;
    void (async () => {
      try {
        const next = await sourceSnapshot(input.watchPath);
        const changed = [
          ...new Set([...snapshot.keys(), ...next.keys()]),
        ].filter((file) => snapshot.get(file) !== next.get(file));
        snapshot = next;
        if (changed.length > 0) {
          revision += 1;
          input.log(
            `Source changed: ${changed.map((file) => path.relative(input.watchPath, file)).join(", ")}; reload queued for the next turn`,
          );
          wake?.();
        }
      } catch (error) {
        failures.push(
          error instanceof Error ? error : new Error(String(error)),
        );
        wake?.();
      } finally {
        scanning = false;
      }
    })();
  }, 100);
  const stopped = () => input.signal.aborted;
  const checkWatcher = () => {
    const failure = failures[0];
    if (failure !== undefined) throw failure;
  };
  const stop = () => wake?.();
  input.signal.addEventListener("abort", stop);
  try {
    do {
      checkWatcher();
      const startedRevision = revision;
      const exitCode = await input.turn();
      if (exitCode !== 0)
        input.log(
          `Reconcile exited ${String(exitCode)}; fix the error and save to retry`,
        );
      if (stopped()) break;
      checkWatcher();
      // Saves during a turn collapse into one immediate fresh invocation.
      if (startedRevision !== revision) continue;
      input.log(
        `Waiting ${String(input.intervalMs / 1000)}s or for a source edit`,
      );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, input.intervalMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
        if (stopped()) wake();
      });
      wake = undefined;
    } while (!stopped());
  } finally {
    clearInterval(watcher);
    input.signal.removeEventListener("abort", stop);
  }
}
