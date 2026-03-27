export type FetchResult = {
  success: boolean;
  content?: string;
  error?: string;
  durationMs: number;
};

const TIMEOUT_MS = 30_000;

export async function fetchWithLightpanda(
  url: string,
  verbose: boolean,
): Promise<FetchResult> {
  const start = performance.now();
  const args = [
    "fetch",
    "--dump",
    "markdown",
    "--strip_mode",
    "full",
    "--log_level",
    "fatal",
    url,
  ];

  if (verbose) {
    console.error(`[fetch] running: lightpanda ${args.join(" ")}`);
  }

  const proc = Bun.spawn(["lightpanda", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  // Kill process after timeout
  const timer = setTimeout(() => {
    proc.kill();
  }, TIMEOUT_MS);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    const durationMs = performance.now() - start;

    if (verbose) {
      console.error(
        `[fetch] response: ${stdout.length.toLocaleString()} chars in ${String(Math.round(durationMs))}ms`,
      );
    }

    if (durationMs >= TIMEOUT_MS) {
      return {
        success: false,
        error: `lightpanda timed out after ${String(TIMEOUT_MS / 1000)}s`,
        durationMs,
      };
    }

    if (exitCode !== 0) {
      return {
        success: false,
        error:
          stderr.trim() || `lightpanda exited with code ${String(exitCode)}`,
        durationMs,
      };
    }

    return {
      success: true,
      content: stdout,
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
