/**
 * Primary marketing conversion: clicking "Get Started" to enter the web
 * dashboard (sign in → add Scout → configure). Replaces the old
 * "Add to Discord" bot-invite click as the tracked lead event.
 */
export const GET_STARTED_CLICK_EVENT = "get_started_click";

export type GetStartedClickEvent = typeof GET_STARTED_CLICK_EVENT;

/**
 * The web dashboard. Marketing and dashboard share one origin
 * (scout-for-lol.com), so this is a same-origin relative path. The
 * dashboard gates on Discord sign-in and surfaces the "Add Scout to a
 * server" install flow itself — the marketing site no longer links the
 * bot invite directly.
 */
export const APP_DASHBOARD_URL = "/app/";
