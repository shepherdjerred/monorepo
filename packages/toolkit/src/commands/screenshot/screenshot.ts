/**
 * `toolkit screenshot` orchestration: boot/reuse a package's dev server,
 * drive PinchTab to capture a screenshot, and clean up only what this run
 * itself started.
 */
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { resolvePackage } from "#lib/screenshot/catalog.ts";
import { ensureDevServer } from "#lib/screenshot/dev-server.ts";
import { captureScreenshot } from "#lib/screenshot/pinchtab-driver.ts";
import type { AuthFlow } from "#lib/screenshot/types.ts";

export type ScreenshotCommandOptions = {
  alias: string;
  route?: string | undefined;
  out?: string | undefined;
  waitForSelector?: string | undefined;
  timeoutMs?: number | undefined;
  authDiscordId?: string | undefined;
  envOverrides?: Record<string, string> | undefined;
  viewport?: { width: number; height: number } | undefined;
  theme?: "light" | "dark" | undefined;
  fullPage?: boolean | undefined;
};

export type ScreenshotCommandResult = {
  path: string;
  url: string;
  durationMs: number;
};

function defaultOutPath(alias: string, route: string): string {
  const slug =
    route.replaceAll(/[^a-z0-9]+/gi, "-").replaceAll(/^-|-$/g, "") || "root";
  return `${tmpdir()}/toolkit-screenshot/${alias}-${slug}-${Date.now().toString()}.png`;
}

export async function screenshotCommand(
  options: ScreenshotCommandOptions,
): Promise<ScreenshotCommandResult> {
  const start = Date.now();
  const entry = resolvePackage(options.alias);
  const route = options.route ?? entry.defaultRoute;
  const outPath = options.out ?? defaultOutPath(options.alias, route);
  // `dirname` resolves the parent correctly for bare filenames too — a plain
  // `--out screenshot.png` yields "." (cwd), not a bogus `screenshot.pn/` dir
  // from slicing at a nonexistent "/".
  await mkdir(nodePath.dirname(outPath), { recursive: true });

  // Signal-coordinated teardown: a Ctrl-C (or SIGTERM) mid-capture would
  // otherwise terminate the process before the finally blocks below run,
  // leaking BOTH the spawned dev server (Astro/Vite, or the whole Scout
  // dev:web stack) AND the PinchTab session/tab. This is the one place that
  // owns both resources, so it registers a single handler that runs every
  // teardown (newest first) before re-raising the signal with default
  // disposition (so the exit code stays signal-correct).
  const cleanups: (() => Promise<void>)[] = [];
  function onSignal(signal: "SIGINT" | "SIGTERM"): void {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    void (async () => {
      for (const cleanup of [...cleanups].reverse()) {
        try {
          await cleanup();
        } catch (error) {
          console.error(
            `toolkit screenshot: teardown during ${signal} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      process.kill(process.pid, signal);
    })();
  }
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const devServer = await ensureDevServer(entry, {
      envOverrides: options.envOverrides,
      timeoutMs: options.timeoutMs,
    });
    cleanups.push(devServer.stop);

    try {
      const authFlow: { flow: AuthFlow; discordId?: string } | undefined =
        entry.requiresAuth === undefined
          ? undefined
          : options.authDiscordId === undefined
            ? { flow: entry.requiresAuth }
            : { flow: entry.requiresAuth, discordId: options.authDiscordId };

      const { path } = await captureScreenshot({
        baseUrl: devServer.baseUrl,
        route,
        outPath,
        authFlow,
        waitForSelector: options.waitForSelector,
        viewport: options.viewport,
        theme: options.theme,
        fullPage: options.fullPage,
        timeoutMs: options.timeoutMs,
        registerCleanup: (cleanup) => {
          cleanups.push(cleanup);
        },
      });

      return {
        path,
        url: `${devServer.baseUrl}${route}`,
        durationMs: Date.now() - start,
      };
    } finally {
      await devServer.stop();
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
