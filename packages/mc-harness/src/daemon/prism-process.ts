/** The session path is unique; verify `-Dstorm.client.session=<bootstrapPath>` before signaling. */
export function findSessionPids(bootstrapPath: string): number[] {
  const marker = `-Dstorm.client.session=${bootstrapPath}`;
  const result = Bun.spawnSync(["pgrep", "-f", bootstrapPath], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode > 1) {
    throw new Error("Could not inspect controlled client session processes");
  }
  const pids = result.stdout
    .toString()
    .trim()
    .split("\n")
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
  return pids.filter((pid) => {
    const info = Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    return info.exitCode === 0 && info.stdout.toString().includes(marker);
  });
}

function normalizeFoundPids(
  found: number | readonly number[] | undefined,
): number[] {
  if (found === undefined) return [];
  return typeof found === "number" ? [found] : [...found];
}

function signalIgnoreGone(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw error;
  }
}

const defaultControls = {
  find: findSessionPids,
  signal: signalIgnoreGone,
};

export async function stopPrism(
  bootstrapPath: string,
  grace: number,
  controls: {
    find: (path: string) => number | readonly number[] | undefined;
    signal: (pid: number, signal: NodeJS.Signals) => void;
  } = defaultControls,
): Promise<void> {
  const initial = normalizeFoundPids(controls.find(bootstrapPath));
  if (initial.length === 0) return;
  for (const signal of [undefined, "SIGTERM", "SIGKILL"] as const) {
    const active = normalizeFoundPids(controls.find(bootstrapPath));
    if (active.length === 0) return;
    if (signal !== undefined) {
      for (const pid of active) {
        controls.signal(pid, signal);
      }
    }
    const deadline = Date.now() + grace;
    while (Date.now() < deadline) {
      if (normalizeFoundPids(controls.find(bootstrapPath)).length === 0) return;
      await Bun.sleep(100);
    }
  }
  const survivors = normalizeFoundPids(controls.find(bootstrapPath));
  if (survivors.length > 0) {
    throw new Error(
      `Controlled client process ${survivors.map(String).join(", ")} did not exit`,
    );
  }
}
