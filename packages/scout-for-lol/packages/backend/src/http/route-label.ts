/**
 * Maps a request path to a bounded Prometheus label.
 *
 * Prometheus keeps one series per label combination, so the label set must be
 * finite and known in advance. Every path that is not an explicitly recognised
 * route collapses to `other` — an internet-facing service is continuously
 * probed for `/wp-login.php` and friends, and labelling those verbatim would
 * let a scanner mint unbounded series.
 *
 * Dynamic segments are templated (`/api/report/:id/runs/:id.png`) for the same
 * reason. `/trpc` is a single label; per-procedure detail comes from
 * `scout_trpc_calls_total`, which labels by procedure name.
 */

/** Paths matched exactly, mapped to themselves. */
const EXACT_ROUTES = new Set<string>([
  "/ping",
  "/livez",
  "/healthz",
  "/metrics",
  "/api/version",
  "/api/auth/discord/start",
  "/api/auth/discord/callback",
  "/api/auth/logout",
  "/api/discord/install",
  "/api/dev/login",
  "/api/summoner-icon",
  "/api/reports/query-agent/stream",
]);

/** Paths with dynamic segments, mapped to a templated label. */
const PATTERN_ROUTES: readonly { pattern: RegExp; label: string }[] = [
  {
    pattern: /^\/api\/competition\/\d+\/leaderboard\.png$/,
    label: "/api/competition/:id/leaderboard.png",
  },
  {
    pattern: /^\/api\/report\/\d+\/runs\/\d+\.png$/,
    label: "/api/report/:id/runs/:id.png",
  },
];

export const OTHER_ROUTE_LABEL = "other";

export function classifyRoute(pathname: string): string {
  if (EXACT_ROUTES.has(pathname)) {
    return pathname;
  }
  // All tRPC traffic shares one HTTP-level label; per-procedure breakdown lives
  // in the tRPC metrics, which already have a bounded procedure label.
  if (pathname === "/trpc" || pathname.startsWith("/trpc/")) {
    return "/trpc";
  }
  for (const { pattern, label } of PATTERN_ROUTES) {
    if (pattern.test(pathname)) {
      return label;
    }
  }
  return OTHER_ROUTE_LABEL;
}

/** Bucketed status class (`2xx`, `4xx`, …) for cheap error-rate queries. */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100).toString()}xx`;
}

/**
 * Standard HTTP methods. `Request.method` is whatever the remote client sent —
 * it is not restricted to these — so an internet client could otherwise mint a
 * new Prometheus series per invented verb, defeating the bounded-cardinality
 * design of the route label right next to it.
 */
const KNOWN_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "TRACE",
  "CONNECT",
]);

export function classifyMethod(method: string): string {
  return KNOWN_METHODS.has(method) ? method : OTHER_ROUTE_LABEL;
}
