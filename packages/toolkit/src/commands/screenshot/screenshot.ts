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

  const devServer = await ensureDevServer(entry, {
    envOverrides: options.envOverrides,
    timeoutMs: options.timeoutMs,
  });

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
    });

    return {
      path,
      url: `${devServer.baseUrl}${route}`,
      durationMs: Date.now() - start,
    };
  } finally {
    await devServer.stop();
  }
}
