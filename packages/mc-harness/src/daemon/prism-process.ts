/** The session path is unique; verify it in the command line before signaling. */
function prismPid(bootstrapPath: string): number | undefined {
  const result = Bun.spawnSync(["pgrep", "-f", bootstrapPath], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode > 1)
    throw new Error("Could not inspect the controlled Prism process");
  const pids = result.stdout
    .toString()
    .trim()
    .split("\n")
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid);
  const matches = pids.filter((pid) => {
    const info = Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    return (
      info.exitCode === 0 &&
      info.stdout.toString().includes(`-Dstorm.client.session=${bootstrapPath}`)
    );
  });
  if (matches.length > 1)
    throw new Error("Multiple Prism processes own the same session");
  return matches[0];
}

const defaultControls = {
  find: prismPid,
  signal: (pid: number, signal: NodeJS.Signals) => {
    process.kill(pid, signal);
  },
};

export async function stopPrism(
  bootstrapPath: string,
  grace: number,
  controls: {
    find: (path: string) => number | undefined;
    signal: (pid: number, signal: NodeJS.Signals) => void;
  } = defaultControls,
): Promise<void> {
  const initialPid = controls.find(bootstrapPath);
  if (initialPid === undefined) return;
  for (const signal of [undefined, "SIGTERM", "SIGKILL"] as const) {
    if (controls.find(bootstrapPath) !== initialPid) return;
    if (signal !== undefined) controls.signal(initialPid, signal);
    const deadline = Date.now() + grace;
    while (Date.now() < deadline) {
      if (controls.find(bootstrapPath) !== initialPid) return;
      await Bun.sleep(100);
    }
  }
  throw new Error(
    `Controlled Prism process ${String(initialPid)} did not exit`,
  );
}
