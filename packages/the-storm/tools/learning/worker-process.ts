type OwnedProcess = Pick<Bun.Subprocess, "pid" | "exitCode" | "signalCode">;

/** The caller spawns a private POSIX process group with detached: true. */
export class WorkerBudget {
  expired = false;
  interrupted = false;
  private readonly watchdog: ReturnType<typeof setTimeout>;
  private readonly onSignal = () => {
    this.interrupted = true;
    this.stop();
  };

  constructor(
    private readonly child: OwnedProcess,
    remainingMs: number,
  ) {
    if (process.platform !== "darwin" && process.platform !== "linux")
      throw new Error(
        "Paper training requires macOS or Linux process ownership",
      );
    if (child.pid <= 1 || !Number.isFinite(remainingMs))
      throw new Error("invalid owned process or budget");
    this.watchdog = setTimeout(
      () => {
        this.expired = true;
        this.stop();
      },
      Math.max(0, remainingMs),
    );
    process.on("SIGINT", this.onSignal);
    process.on("SIGTERM", this.onSignal);
  }

  stop() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    try {
      // uv forwards many signals, but cannot forward SIGKILL. Stop its private
      // group so an importing or optimizing Python child cannot survive it.
      process.kill(-this.child.pid, "SIGKILL");
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      ))
        throw error;
    }
  }

  close() {
    clearTimeout(this.watchdog);
    process.off("SIGINT", this.onSignal);
    process.off("SIGTERM", this.onSignal);
  }
}
