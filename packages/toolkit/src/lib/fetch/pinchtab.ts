import type { FetchResult } from "./lightpanda.ts";

const TIMEOUT_MS = 30_000;

export async function fetchWithPinchtab(
  url: string,
  verbose: boolean,
): Promise<FetchResult> {
  const start = performance.now();

  if (verbose) {
    console.error(`[fetch] engine: pinchtab`);
    console.error(
      `[fetch] running: pinchtab nav ${url} --block-ads --block-images`,
    );
  }

  // Navigate to the page
  const navProc = Bun.spawn(
    ["pinchtab", "nav", url, "--block-ads", "--block-images"],
    { stdout: "ignore", stderr: "pipe" },
  );

  const navTimer = setTimeout(() => {
    navProc.kill();
  }, TIMEOUT_MS);
  try {
    const navStderr = await new Response(navProc.stderr).text();
    const navExit = await navProc.exited;

    if (navExit !== 0) {
      return {
        success: false,
        error:
          navStderr.trim() ||
          `pinchtab nav exited with code ${String(navExit)}`,
        durationMs: performance.now() - start,
      };
    }
  } finally {
    clearTimeout(navTimer);
  }

  if (verbose) {
    console.error(`[fetch] running: pinchtab text`);
  }

  // Extract text content
  const textProc = Bun.spawn(["pinchtab", "text"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const textTimer = setTimeout(() => {
    textProc.kill();
  }, TIMEOUT_MS);
  try {
    const [stdout, textStderr] = await Promise.all([
      new Response(textProc.stdout).text(),
      new Response(textProc.stderr).text(),
    ]);

    const textExit = await textProc.exited;
    const durationMs = performance.now() - start;

    if (verbose) {
      console.error(
        `[fetch] response: ${stdout.length.toLocaleString()} chars in ${String(Math.round(durationMs))}ms`,
      );
    }

    if (textExit !== 0) {
      return {
        success: false,
        error:
          textStderr.trim() ||
          `pinchtab text exited with code ${String(textExit)}`,
        durationMs,
      };
    }

    return {
      success: true,
      content: stdout,
      durationMs,
    };
  } finally {
    clearTimeout(textTimer);
  }
}
