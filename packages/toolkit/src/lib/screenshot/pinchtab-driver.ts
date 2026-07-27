/**
 * Drives PinchTab to capture a screenshot of a booted dev server: create a
 * scoped agent session, navigate (through an auth flow first if the package
 * needs one), wait for readiness, screenshot, and clean up.
 */
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
   * Register a teardown action (here: revoking the just-created session) with
   * the orchestrator so it can run on a SIGINT/SIGTERM that would otherwise
   * kill the process before this function's own cleanup. See screenshotCommand.
   */
  registerCleanup?: ((cleanup: () => Promise<void>) => void) | undefined;
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

/**
 * Everything between session-create and session-revoke: open a tab, configure
 * viewport/media emulation *before* loading the target page, wait for
 * readiness, screenshot, and close the tab.
 */
async function runCapture(
  session: { sessionToken: string },
  options: CaptureOptions,
): Promise<{ path: string }> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const targetUrl =
    options.authFlow === undefined
      ? `${options.baseUrl}${options.route}`
      : `${options.baseUrl}${authUrlFor(options.authFlow.flow, options.route, options.authFlow.discordId)}`;

  // Open a blank tab first so viewport + `prefers-color-scheme` emulation is
  // applied before the real page's first paint. Pages that read `matchMedia`
  // once at load (e.g. cooklang-rich-preview's inline theme init) and never
  // listen for changes would otherwise ignore a media override set after nav.
  const tabId = unwrap(
    await navigateNewTab(session.sessionToken, "about:blank"),
    "pinchtab nav",
  );

  if (options.viewport) {
    unwrap(
      await setViewport(
        session.sessionToken,
        tabId,
        options.viewport.width,
        options.viewport.height,
      ),
      "pinchtab set viewport",
    );
  }
  if (options.theme) {
    unwrap(
      await setMedia(
        session.sessionToken,
        tabId,
        "prefers-color-scheme",
        options.theme,
      ),
      "pinchtab set media",
    );
  }

  // Now load the real target in the pre-configured tab.
  unwrap(
    await navigateTab(session.sessionToken, tabId, targetUrl),
    "pinchtab nav",
  );

  if (options.waitForSelector === undefined) {
    // No selector to wait on — a short fixed settle delay for the page's
    // own post-load rendering/data fetches.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } else {
    const selector = options.waitForSelector;
    const deadline = Date.now() + timeoutMs;
    let found = false;
    while (Date.now() < deadline) {
      const count = unwrap(
        await countSelector(session.sessionToken, tabId, selector),
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

  // For auth flows, confirm we actually landed in the app before capturing —
  // the readiness probe only checks the server is up, not that /api/dev/login
  // succeeded. If the login endpoint errored (e.g. its upsert/JWT signing
  // failed), the tab would sit on the error response, not the requested route,
  // and we'd otherwise screenshot that and report success.
  if (options.authFlow !== undefined) {
    const landedUrl = unwrap(
      await currentUrl(session.sessionToken, tabId),
      "pinchtab url",
    );
    const prefix = AUTH_ROUTE_PREFIX[options.authFlow.flow];
    if (!new URL(landedUrl).pathname.startsWith(prefix)) {
      throw new Error(
        `${options.authFlow.flow}: expected to land on a path under "${prefix}" but the tab is at "${landedUrl}" — the login redirect likely failed (e.g. /api/dev/login returned an error).`,
      );
    }
  }

  unwrap(
    await pinchtabScreenshot(session.sessionToken, tabId, options.outPath, {
      fullPage: options.fullPage,
    }),
    "pinchtab screenshot",
  );

  unwrap(await closeTab(session.sessionToken, tabId), "pinchtab tab close");
  return { path: options.outPath };
}

export async function captureScreenshot(
  options: CaptureOptions,
): Promise<{ path: string }> {
  const session = unwrap(
    await createSession(AGENT_ID, `toolkit screenshot ${options.route}`),
    "pinchtab session create",
  );

  // Hand the session's teardown to the orchestrator so a SIGINT/SIGTERM that
  // kills the process before the paths below run still revokes the session
  // (and stops the dev server) — signal teardown is coordinated in
  // screenshotCommand, which owns both resources.
  options.registerCleanup?.(async () => {
    await revokeSession(session.id);
  });

  let capture: { path: string };
  try {
    capture = await runCapture(session, options);
  } catch (error) {
    // Still release the isolated session on failure, but let the original
    // capture error win — a cleanup failure here must not mask it.
    await revokeSession(session.id);
    throw error;
  }

  // Happy path: revoking the session is the documented isolation guarantee, so
  // a nonzero revoke is a real failure, not something to swallow.
  unwrap(await revokeSession(session.id), "pinchtab session revoke");
  return capture;
}
