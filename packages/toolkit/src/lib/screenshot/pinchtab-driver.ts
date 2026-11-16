/**
 * Drives PinchTab to capture a screenshot of a booted dev server: create a
 * scoped agent session, record lease files under `~/.toolkit/tend/leases`,
 * navigate (through an auth flow first if the package needs one), wait for
 * readiness, screenshot, and always close opened tabs + remove leases in
 * `finally`.
 */
import http from "node:http";
import {
  closeTab,
  countSelector,
  createSession,
  currentUrl,
  navigateNewTab,
  navigateTab,
  revokeSession,
  screenshot as pinchtabScreenshot,
  setMedia,
  setViewport,
} from "#lib/pinchtab-cli/client.ts";
import { createPinchtabLease } from "./pinchtab-lease.ts";
import type { AuthFlow } from "./types.ts";

const AGENT_ID = "toolkit-screenshot";

/**
 * Login path per auth flow. Only one exists today; add entries here (not a
 * switch) when a second package needs its own dev-only login route.
 */
const AUTH_LOGIN_PATHS: Record<AuthFlow, string> = {
  "scout-dev-login": "/api/dev/login",
};

/**
 * The path prefix each auth flow's post-login `returnTo` is constrained to.
 * Scout's `safeReturnTo` rewrites anything outside `/app/` back to `/app/`
 * (open-redirect guard), so a requested route outside this prefix can't
 * actually be reached through the login redirect.
 */
const AUTH_ROUTE_PREFIX: Record<AuthFlow, string> = {
  "scout-dev-login": "/app/",
};

/**
 * Reject a route that the auth flow's redirect would rewrite — otherwise the
 * command would sign in, land on the rewritten page (e.g. `/app/`), and report
 * success for the requested URL (e.g. `/`) while having screenshotted a
 * different page. Fail fast with an actionable message instead.
 */
export function assertAuthRouteReachable(flow: AuthFlow, route: string): void {
  const prefix = AUTH_ROUTE_PREFIX[flow];
  if (!route.startsWith(prefix)) {
    throw new Error(
      `Route "${route}" can't be reached through the ${flow} auth flow: the login redirect only lands on paths under "${prefix}" (anything else is rewritten to "${prefix}"). Request a "${prefix}…" route.`,
    );
  }
}

/**
 * Builds the URL to navigate to first for a given auth flow — PinchTab's
 * `nav` follows redirects itself, so one navigation to this URL both signs
 * the tab in and lands it on `route` once the flow's own redirect resolves.
 */
function authUrlFor(
  flow: AuthFlow,
  route: string,
  discordId: string | undefined,
): string {
  const params = new URLSearchParams({ returnTo: route });
  if (discordId !== undefined) {
    params.set("discordId", discordId);
  }
  return `${AUTH_LOGIN_PATHS[flow]}?${params.toString()}`;
}

export type PinchtabDriverClient = {
  createSession: typeof createSession;
  revokeSession: typeof revokeSession;
  navigateNewTab: typeof navigateNewTab;
  navigateTab: typeof navigateTab;
  setViewport: typeof setViewport;
  setMedia: typeof setMedia;
  countSelector: typeof countSelector;
  currentUrl: typeof currentUrl;
  screenshot: typeof pinchtabScreenshot;
  closeTab: typeof closeTab;
};

const defaultClient: PinchtabDriverClient = {
  createSession,
  revokeSession,
  navigateNewTab,
  navigateTab,
  setViewport,
  setMedia,
  countSelector,
  currentUrl,
  screenshot: pinchtabScreenshot,
  closeTab,
};

export type CaptureOptions = {
  baseUrl: string;
  route: string;
  outPath: string;
  authFlow?: { flow: AuthFlow; discordId?: string | undefined } | undefined;
  waitForSelector?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
  theme?: "light" | "dark" | undefined;
  fullPage?: boolean | undefined;
  timeoutMs?: number | undefined;
  /**
   * Register a teardown action with the orchestrator so it can run on a
   * SIGINT/SIGTERM that would otherwise kill the process before `finally`
   * blocks complete. See screenshotCommand.
   */
  registerCleanup?: ((cleanup: () => Promise<void>) => void) | undefined;
  /** Optional PinchTab client override for unit tests. */
  client?: PinchtabDriverClient | undefined;
};

function unwrap<T>(
  result: {
    success: boolean;
    data?: T | undefined;
    error?: string | undefined;
  },
  action: string,
): T {
  if (!result.success || result.data === undefined) {
    throw new Error(`${action} failed: ${result.error ?? "unknown error"}`);
  }
  return result.data;
}

/** Normalize a path for comparison: drop a single trailing slash (keep "/"). */
function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Start a short-lived loopback HTTP server serving an empty HTML document so
 * PinchTab 0.15.2+ (which rejects `about:blank` and `data:` URLs with HTTP 400)
 * can open a blank tab and apply viewport / `prefers-color-scheme` emulation
 * before the target page's first paint.
 */
async function withBlankHttpPage<T>(
  fn: (blankUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>blank</title>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  try {
    const addr = server.address();
    const port = addr !== null && typeof addr === "object" ? addr.port : 0;
    return await fn(`http://127.0.0.1:${String(port)}/`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

async function openConfiguredTargetTab(
  sessionToken: string,
  targetUrl: string,
  options: CaptureOptions,
  client: PinchtabDriverClient,
): Promise<{
  tabId: string;
  tabLease: Awaited<ReturnType<typeof createPinchtabLease>>;
  cleanupTab: (strict: boolean) => Promise<void>;
}> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const needsPrePaintEmulation =
    options.viewport !== undefined || options.theme !== undefined;

  const tabId = needsPrePaintEmulation
    ? await withBlankHttpPage(async (blankUrl) =>
        unwrap(
          await client.navigateNewTab(sessionToken, blankUrl),
          "pinchtab nav",
        ),
      )
    : unwrap(
        await client.navigateNewTab(sessionToken, targetUrl),
        "pinchtab nav",
      );

  const tabLease = await createPinchtabLease(tabId, timeoutMs);

  let tabCleanedUp = false;
  const cleanupTab = async (strict: boolean): Promise<void> => {
    if (tabCleanedUp) {
      return;
    }
    tabCleanedUp = true;
    try {
      const closed = await client.closeTab(sessionToken, tabId);
      if (strict) {
        unwrap(closed, "pinchtab tab close");
      }
    } finally {
      await tabLease.release();
    }
  };

  options.registerCleanup?.(async () => {
    await cleanupTab(false);
  });

  if (needsPrePaintEmulation) {
    try {
      if (options.viewport) {
        unwrap(
          await client.setViewport(
            sessionToken,
            tabId,
            options.viewport.width,
            options.viewport.height,
          ),
          "pinchtab set viewport",
        );
      }
      if (options.theme) {
        unwrap(
          await client.setMedia(
            sessionToken,
            tabId,
            "prefers-color-scheme",
            options.theme,
          ),
          "pinchtab set media",
        );
      }
      unwrap(
        await client.navigateTab(sessionToken, tabId, targetUrl),
        "pinchtab nav",
      );
    } catch (error) {
      await cleanupTab(false);
      throw error;
    }
  }

  return { tabId, tabLease, cleanupTab };
}

/**
 * Everything between session-create and session-revoke: open a tab, track its
 * lease, configure viewport/media emulation *before* loading the target page,
 * wait for readiness, screenshot, and always close the tab + lease in `finally`.
 */
async function runCapture(
  session: { sessionToken: string },
  options: CaptureOptions,
  client: PinchtabDriverClient,
): Promise<{ path: string }> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const targetUrl =
    options.authFlow === undefined
      ? `${options.baseUrl}${options.route}`
      : `${options.baseUrl}${authUrlFor(options.authFlow.flow, options.route, options.authFlow.discordId)}`;

  const { tabId, cleanupTab } = await openConfiguredTargetTab(
    session.sessionToken,
    targetUrl,
    options,
    client,
  );

  let succeeded = false;
  try {
    if (options.waitForSelector === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      const selector = options.waitForSelector;
      const deadline = Date.now() + timeoutMs;
      let found = false;
      while (Date.now() < deadline) {
        const count = unwrap(
          await client.countSelector(session.sessionToken, tabId, selector),
          "pinchtab count",
        );
        if (count.count > 0) {
          found = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (!found) {
        throw new Error(
          `selector "${selector}" never appeared within ${String(timeoutMs)}ms`,
        );
      }
    }

    if (options.authFlow !== undefined) {
      const landedUrl = unwrap(
        await client.currentUrl(session.sessionToken, tabId),
        "pinchtab url",
      );
      const landedPath = new URL(landedUrl).pathname;
      if (
        stripTrailingSlash(landedPath) !== stripTrailingSlash(options.route)
      ) {
        throw new Error(
          `${options.authFlow.flow}: expected to land on "${options.route}" but the tab is at "${landedUrl}" — the route may not exist (the app redirected it) or the login redirect failed.`,
        );
      }
    }

    unwrap(
      await client.screenshot(session.sessionToken, tabId, options.outPath, {
        fullPage: options.fullPage,
      }),
      "pinchtab screenshot",
    );

    succeeded = true;
    return { path: options.outPath };
  } finally {
    await cleanupTab(succeeded);
  }
}

export async function captureScreenshot(
  options: CaptureOptions,
): Promise<{ path: string }> {
  const client = options.client ?? defaultClient;
  const session = unwrap(
    await client.createSession(AGENT_ID, `toolkit screenshot ${options.route}`),
    "pinchtab session create",
  );
  const sessionLease = await createPinchtabLease(session.id, options.timeoutMs);

  let sessionCleanedUp = false;
  const cleanupSession = async (strict: boolean): Promise<void> => {
    if (sessionCleanedUp) {
      return;
    }
    sessionCleanedUp = true;
    try {
      const revoked = await client.revokeSession(session.id);
      if (strict) {
        unwrap(revoked, "pinchtab session revoke");
      }
    } finally {
      await sessionLease.release();
    }
  };

  options.registerCleanup?.(async () => {
    await cleanupSession(false);
  });

  let succeeded = false;
  try {
    const capture = await runCapture(session, options, client);
    succeeded = true;
    return capture;
  } finally {
    await cleanupSession(succeeded);
  }
}
