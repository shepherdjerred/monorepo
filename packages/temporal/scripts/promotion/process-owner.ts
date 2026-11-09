/** PID presence alone is insufficient after an executor exits and its PID is reused. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    throw error;
  }
  return true;
}

export function localOwnerAlive(pid: number, acquiredAt?: string): boolean {
  if (!Number.isInteger(pid) || pid <= 0)
    throw new TypeError("Invalid executor PID");
  const claimedAt =
    acquiredAt === undefined ? undefined : Date.parse(acquiredAt);
  if (claimedAt !== undefined && !Number.isFinite(claimedAt))
    throw new TypeError("Invalid executor claim time");
  if (!processAlive(pid)) return false;
  if (claimedAt === undefined) return true;
  const result = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="], {
    env: { PATH: Bun.env["PATH"], TZ: Bun.env.TZ, LC_ALL: "C" },
  });
  if (result.exitCode !== 0) {
    if (!processAlive(pid)) return false;
    throw new Error("Cannot inspect the live executor process");
  }
  const started = Date.parse(result.stdout.toString().trim());
  if (!Number.isFinite(started))
    throw new TypeError("Cannot determine executor process identity");
  return started <= claimedAt;
}
