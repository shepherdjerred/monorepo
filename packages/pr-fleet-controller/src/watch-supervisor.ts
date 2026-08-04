import path from "node:path";

export type WatcherProcess = ReturnType<typeof Bun.spawn>;

/**
 * Spawn the read-only live dashboard as a detached child pointed at this run's
 * bundle. Detached (its own process group) so a terminal Ctrl-C reaches only the
 * controller; the controller's finalizer then tears the child down
 * deterministically. Best-effort: a spawn failure logs and returns undefined
 * rather than aborting the run.
 */
export function spawnWatcher(
  runDirectory: string,
  options: { uiPort?: string; open: boolean },
): WatcherProcess | undefined {
  const watcherArgs = [
    "bun",
    "run",
    path.join(import.meta.dir, "watch-cli.ts"),
    "--run",
    runDirectory,
    ...(options.uiPort === undefined ? [] : ["--port", options.uiPort]),
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

/** Terminate the watcher's whole process group, tolerating an already-exited child. */
export function stopWatcher(watcher: WatcherProcess | undefined): void {
  if (watcher === undefined) {
    return;
  }
  try {
    // A detached child leads its own group; the negative PID kills descendants
    // too. ESRCH means it already exited — nothing to do.
    process.kill(-watcher.pid, "SIGTERM");
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ESRCH")
    ) {
      process.stderr.write(
        `Failed to stop the dashboard: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}
