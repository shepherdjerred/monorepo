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

export async function captureScreenshot(
  options: CaptureOptions,
): Promise<{ path: string }> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const session = unwrap(
    await createSession(AGENT_ID, `toolkit screenshot ${options.route}`),
    "pinchtab session create",
  );

  try {
    const targetUrl =
      options.authFlow === undefined
        ? `${options.baseUrl}${options.route}`
        : `${options.baseUrl}${authUrlFor(options.authFlow.flow, options.route, options.authFlow.discordId)}`;

    const tabId = unwrap(
      await navigateNewTab(session.sessionToken, targetUrl),
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

    await closeTab(session.sessionToken, tabId);
    return { path: options.outPath };
  } finally {
    await revokeSession(session.id);
  }
}
