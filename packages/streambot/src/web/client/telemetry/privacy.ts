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

/** Removes the query string from every URL or path inside free text such as an error message. */
export function scrubText(text: string): string {
  return text.replaceAll(
    /([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*|\/[^\s?#"'<>]*)[?#][^\s"'<>]*/giu,
    "$1",
  );
}

/**
 * A link target as analytics may record it, absolute or relative: this site's paths become their
 * route pattern, a bare query or fragment becomes empty, and another site keeps only its origin.
 */
export function sanitizeHref(value: string, siteOrigin: string): string {
  if (ABSOLUTE_URL.test(value)) return sanitizeUrl(value, siteOrigin);
  if (value.startsWith("/")) return routePattern(value);
  return value.startsWith("?") || value.startsWith("#")
    ? ""
    : sanitizeUrl(new URL(value, siteOrigin + "/").href, siteOrigin);
}

/**
 * Automatic properties that carry page text: the document title (it holds the search), link text
 * and every element attribute but `class` and `href`, since labels name the item.
 */
function textProperty(key: string): boolean {
  return (
    ["title", "$title", "$el_text"].includes(key) ||
    (key.startsWith("attr_") && key !== "attr__class" && key !== "attr__href")
  );
}

/** One element of `$elements`: its tag, classes, position and sanitized link, nothing else. */
const ELEMENT_KEYS = new Set([
  "tag_name",
  "classes",
  "attr__class",
  "attr__href",
  "href",
  "nth_child",
  "nth_of_type",
  "order",
]);

/**
 * `$elements_chain` (`a.row:attr__href="/album/x?q=…"href="…"nth-child="1"text="…"`) keeps only
 * classes, positions and sanitized links; text, ids and labels are removed.
 */
export function sanitizeElementsChain(
  chain: string,
  siteOrigin: string,
): string {
  return chain.replaceAll(
    /([\w-]+)="((?:[^"\\]|\\.)*)"/gu,
    (_match, name: string, value: string) => {
      switch (name) {
        case "attr__class":
        case "nth-child":
        case "nth-of-type":
          return `${name}="${value}"`;
        case "href":
        case "attr__href":
          return `${name}="${sanitizeHref(value, siteOrigin)}"`;
        default:
          return "";
      }
    },
  );
}

/**
 * A string as analytics may record it. URLs and paths anywhere (absolute, `/library?series=…`,
 * `?q=…`) lose their query and concrete ids; free text loses any embedded query string.
 */
function sanitizeString(key: string, value: string, siteOrigin: string) {
  if (key === "$elements_chain")
    return sanitizeElementsChain(value, siteOrigin);
  const whole = !/\s/u.test(value);
  if (whole && ABSOLUTE_URL.test(value)) return sanitizeUrl(value, siteOrigin);
  return whole && /^[/?#]/u.test(value)
    ? sanitizeHref(value, siteOrigin)
    : scrubText(value);
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
  if (typeof value !== "object" || value === null) return value;
  const record = Object.fromEntries(Object.entries(value));
  return sanitizeRecord(
    key === "$elements"
      ? Object.fromEntries(
          Object.entries(record).filter(([name]) => ELEMENT_KEYS.has(name)),
        )
      : record,
    siteOrigin,
  );
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
    if (textProperty(rawKey)) continue;
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

/** rrweb's own serialisation: the inlined app stylesheet and its layout metadata. */
const RRWEB_ATTRIBUTES = new Set([
  "_csstext",
  "rr_width",
  "rr_height",
  "rr_left",
  "rr_top",
  "rr_position",
  "rr_transform",
  "rr_display",
  "rr_scrollleft",
  "rr_scrolltop",
  "rr_mediastate",
  "rr_open_mode",
]);

/**
 * The replay value of one element attribute: layout attributes as they are, others blanked — so a
 * link's `href` is always empty in recorded DOM, in the full snapshot and in later mutations alike.
 * rrweb also passes its own serialisation through here: an inlined stylesheet (`_cssText`, the
 * app's own CSS) and its generated `rr_*` layout metadata are kept so replay still renders.
 */
export function replayAttribute(name: string, value: string): string {
  const lower = name.toLowerCase();
  return LAYOUT_ATTRIBUTES.has(lower) || RRWEB_ATTRIBUTES.has(lower)
    ? value
    : "";
}

/** The browser privacy signals Streambot honours before loading any analytics code. */
export type PrivacySignals = {
  readonly doNotTrack: unknown;
  readonly windowDoNotTrack: unknown;
  readonly globalPrivacyControl: unknown;
};

/**
 * True only on the registered production host. A local, preview or fixture origin never loads the
 * tracker, whatever `/api/me` says, so a development run cannot reach the production project.
 */
export function productionHost(host: string, registeredHost: string): boolean {
  return host === registeredHost;
}

/** False when the browser asks not to be tracked by Do Not Track or Global Privacy Control. */
export function trackingAllowed(signals: PrivacySignals): boolean {
  const dnt = [signals.doNotTrack, signals.windowDoNotTrack].some(
    (value) => value === "1" || value === "yes",
  );
  return !dnt && signals.globalPrivacyControl !== true;
}
