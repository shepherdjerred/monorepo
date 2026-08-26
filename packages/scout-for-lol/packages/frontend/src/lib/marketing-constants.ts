import { surfaceHref } from "@scout-for-lol/design-system/layout";

function localSurfaceOrigin(
  configured: unknown,
  developmentFallback: string,
): string | undefined {
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  return import.meta.env.DEV ? developmentFallback : undefined;
}

export const APP_ORIGIN = localSurfaceOrigin(
  import.meta.env["PUBLIC_APP_ORIGIN"],
  "http://localhost:5180",
);
export const DOCS_ORIGIN = localSurfaceOrigin(
  import.meta.env["PUBLIC_DOCS_ORIGIN"],
  "http://localhost:4322",
);

/**
 * Primary marketing conversion: clicking "Get Started" to enter the web
 * dashboard (sign in → add Scout → configure). Replaces the old
 * "Add to Discord" bot-invite click as the tracked lead event.
 */
export const GET_STARTED_CLICK_EVENT = "get_started_click";

export type GetStartedClickEvent = typeof GET_STARTED_CLICK_EVENT;

/**
 * The web dashboard. Production and beta use the same-origin path; local
 * multi-surface development supplies `PUBLIC_APP_ORIGIN` so this crosses to
 * the separately running Vite server. The dashboard gates on Discord sign-in
 * and surfaces the "Add Scout to a server" install flow itself.
 */
export const APP_LOGIN_URL = surfaceHref(
  APP_ORIGIN,
  "/app/login?returnTo=/app/",
);
export const APP_EXPLORE_URL = surfaceHref(APP_ORIGIN, "/app/explore");
export const APP_PLAYERS_URL = surfaceHref(APP_ORIGIN, "/app/players");

/** The same-origin Starlight documentation site shipped with the Scout release. */
export const DOCS_URL = surfaceHref(DOCS_ORIGIN, "/docs/");
