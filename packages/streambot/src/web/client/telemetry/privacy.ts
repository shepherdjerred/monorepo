import { z } from "zod";

/**
 * What browser telemetry may say about a page. Everything here is a pure function so the privacy
 * test can run it over fixture data: a URL keeps only its origin and route pattern, a path keeps
 * only its pattern, and text that could carry a title, a query or a name is removed.
 */

/**
 * Every route the remote serves, as the pattern analytics reports. Keep this in step with the
 * `<Route>` list in `app.tsx`; a path that matches none reports as `/other`, never as itself.
 */
export const ROUTE_PATTERNS = [
  "/",
  "/library",
  "/playlists",
  "/playlists/:id",
  "/live",
  "/history",
  "/album/:id",
  "/artist/:id",
] as const;
export type RoutePattern = (typeof ROUTE_PATTERNS)[number] | "/other";

function segments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/** The route pattern of a pathname; ids become `:id` and the query string is never part of it. */
export function routePattern(pathname: string): RoutePattern {
  const actual = segments(pathname.split(/[?#]/u)[0] ?? "");
  for (const pattern of ROUTE_PATTERNS) {
    const expected = segments(pattern);
    if (
      expected.length === actual.length &&
      expected.every(
        (segment, index) =>
          segment.startsWith(":") || segment === actual[index],
      )
    )
      return pattern;
  }
  return "/other";
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//iu;

/**
 * A URL as analytics may record it: this site's pages become origin + route pattern, any other
 * address keeps only its origin. Query strings, fragments and other sites' paths never survive.
 */
export function sanitizeUrl(value: string, siteOrigin: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  return url.origin === siteOrigin
    ? url.origin + routePattern(url.pathname)
    : url.origin;
}

/** Automatic properties that carry page text: the document title (it holds the search) and link text. */
const TEXT_PROPERTIES = new Set(["title", "$title", "$el_text"]);

function sanitizeString(key: string, value: string, siteOrigin: string) {
  if (ABSOLUTE_URL.test(value)) return sanitizeUrl(value, siteOrigin);
  return /pathname$/iu.test(key) && value.startsWith("/")
    ? routePattern(value)
    : value;
}

const ListSchema = z.array(z.unknown());

function sanitizeValue(
  key: string,
  value: unknown,
  siteOrigin: string,
): unknown {
  if (typeof value === "string") return sanitizeString(key, value, siteOrigin);
  const list = ListSchema.safeParse(value);
  if (list.success)
    return list.data.map((entry) => sanitizeValue(key, entry, siteOrigin));
  return typeof value === "object" && value !== null
    ? sanitizeRecord(Object.fromEntries(Object.entries(value)), siteOrigin)
    : value;
}

/**
 * Applies `sanitizeUrl` to every URL anywhere in a capture (nested web-vitals entries, heatmap data
 * keyed by URL, person properties), maps every `…pathname` to its pattern, and drops title and
 * element text. Keys that are URLs are sanitized too; entries that collapse onto one key merge.
 */
export function sanitizeRecord(
  record: Readonly<Record<string, unknown>>,
  siteOrigin: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    if (TEXT_PROPERTIES.has(rawKey)) continue;
    const key = ABSOLUTE_URL.test(rawKey)
      ? sanitizeUrl(rawKey, siteOrigin)
      : rawKey;
    const value = sanitizeValue(key, rawValue, siteOrigin);
    const existing = ListSchema.safeParse(result[key]);
    const incoming = ListSchema.safeParse(value);
    result[key] =
      existing.success && incoming.success
        ? [...existing.data, ...incoming.data]
        : value;
  }
  return result;
}

/**
 * Element attributes that only describe layout or state, kept in session replay. Everything else
 * (`aria-label`, `title`, `alt`, `href`, `src`, `data-*` …) is blanked, because labels name the
 * item ("More ways to play <title>") and links and artwork carry ids. Text is masked separately.
 */
const LAYOUT_ATTRIBUTES = new Set([
  "class",
  "id",
  "type",
  "role",
  "rel",
  "lang",
  "dir",
  "tabindex",
  "hidden",
  "disabled",
  "open",
  "width",
  "height",
  "colspan",
  "rowspan",
  "aria-hidden",
  "aria-busy",
  "aria-disabled",
  "aria-expanded",
  "aria-current",
  "aria-selected",
  "aria-pressed",
  "aria-checked",
  "aria-live",
  "aria-modal",
]);

/** The replay value of one element attribute: layout attributes as they are, others blanked. */
export function replayAttribute(name: string, value: string): string {
  return LAYOUT_ATTRIBUTES.has(name.toLowerCase()) ? value : "";
}

/** The browser privacy signals Streambot honours before loading any analytics code. */
export type PrivacySignals = {
  readonly doNotTrack: unknown;
  readonly windowDoNotTrack: unknown;
  readonly globalPrivacyControl: unknown;
};

/** False when the browser asks not to be tracked by Do Not Track or Global Privacy Control. */
export function trackingAllowed(signals: PrivacySignals): boolean {
  const dnt = [signals.doNotTrack, signals.windowDoNotTrack].some(
    (value) => value === "1" || value === "yes",
  );
  return !dnt && signals.globalPrivacyControl !== true;
}
