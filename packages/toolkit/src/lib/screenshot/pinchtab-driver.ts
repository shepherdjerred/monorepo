/**
 * Drives PinchTab to capture a screenshot of a booted dev server: create a
 * scoped agent session, navigate (through an auth flow first if the package
 * needs one), wait for readiness, screenshot, and clean up.
 */
import {
  closeTab,
  countSelector,
  createSession,
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
