export type FetchResult = {
  success: boolean;
  content?: string;
  error?: string;
  durationMs: number;
};

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
    console.error(
      `[fetch] running: lightpanda ${args.join(" ")}`,
    );
  }

  const proc = Bun.spawn(["lightpanda", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  const durationMs = performance.now() - start;

  if (verbose) {
    console.error(
      `[fetch] response: ${stdout.length.toLocaleString()} chars in ${Math.round(durationMs)}ms`,
    );
  }

  if (exitCode !== 0) {
    return {
      success: false,
      error: stderr.trim() || `lightpanda exited with code ${String(exitCode)}`,
      durationMs,
    };
  }

  return {
    success: true,
    content: stdout,
    durationMs,
  };
}
