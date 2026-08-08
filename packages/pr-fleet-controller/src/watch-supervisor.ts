import path from "node:path";

type WatcherProcess = ReturnType<typeof Bun.spawn>;

/**
 * Spawn the read-only live dashboard as a detached child pointed at this run's
 * bundle. Detached (its own process group) so a terminal Ctrl-C reaches only the
 * controller; the controller's finalizer then tears the child down
 * deterministically. Best-effort: a spawn failure logs and returns undefined
 * rather than aborting the run.
 */
export function spawnWatcher(
  runDirectory: string,
  options: { uiPort?: string; open: boolean; controlSocket?: string },
): WatcherProcess | undefined {
  const watcherArgs = [
    "bun",
    "run",
    path.join(import.meta.dir, "watch-cli.ts"),
    "--run",
    runDirectory,
    ...(options.uiPort === undefined ? [] : ["--port", options.uiPort]),
    ...(options.controlSocket === undefined
      ? []
      : ["--control-socket", options.controlSocket]),
    ...(options.open ? [] : ["--no-open"]),
  ];
  try {
    return Bun.spawn(watcherArgs, {
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
      detached: true,
    });
  } catch (error) {
    process.stderr.write(
      `Could not start the dashboard (${error instanceof Error ? error.message : String(error)}). Continuing without it.\n`,
    );
    return undefined;
  }
}

export function spawnCliWatcher(
  runDirectory: string,
  controlSocket: string,
  args: readonly string[],
): WatcherProcess | undefined {
  if (args.includes("--no-ui")) {
    return undefined;
  }
  const portIndex = args.indexOf("--ui-port");
  const uiPort = portIndex === -1 ? undefined : args[portIndex + 1];
  return spawnWatcher(runDirectory, {
    ...(uiPort === undefined ? {} : { uiPort }),
    open: !args.includes("--no-open"),
    controlSocket,
  });
}

// The dashboard tails the run bundle on a fixed poll interval and has no
// delivery acknowledgement, so before teardown we give it a bounded window to
// forward the just-written terminal events (run.completed/failed + the final
// snapshot) to any connected browser. Sized to comfortably cover several of the
// watcher's 300ms tail cycles.
const WATCHER_DRAIN_MS = 900;
// After signalling, wait this long for the child to exit gracefully before
// escalating to SIGKILL so a wedged watcher can never hold its port forever.
const WATCHER_EXIT_TIMEOUT_MS = 2000;

function isAlreadyExited(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function signalGroup(
  watcher: WatcherProcess,
  signal: "SIGTERM" | "SIGKILL",
): void {
  try {
    // A detached child leads its own group; the negative PID reaches the whole
    // tree. ESRCH means it already exited — nothing to do.
    process.kill(-watcher.pid, signal);
  } catch (error) {
    if (!isAlreadyExited(error)) {
      process.stderr.write(
        `Failed to stop the dashboard: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

/**
 * Tear the watcher's whole process group down, tolerating an already-exited
 * child. Drains a bounded window first so the terminal run state reaches the
 * browser, then signals SIGTERM and waits for a graceful exit, escalating to
 * SIGKILL only if the child overstays.
 */
export async function stopWatcher(
  watcher: WatcherProcess | undefined,
): Promise<void> {
  if (watcher === undefined) {
    return;
  }
  await Bun.sleep(WATCHER_DRAIN_MS);
  signalGroup(watcher, "SIGTERM");
  const exitedGracefully = await Promise.race([
    watcher.exited.then(() => true),
    Bun.sleep(WATCHER_EXIT_TIMEOUT_MS).then(() => false),
  ]);
  if (!exitedGracefully) {
    signalGroup(watcher, "SIGKILL");
  }
}
