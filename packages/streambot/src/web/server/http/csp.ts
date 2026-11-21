import { ARTWORK_HOSTS } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import { ANALYTICS_SITE } from "@shepherdjerred/streambot/web/shared/analytics-site.ts";

/**
 * The scripts the PostHog SDK loads from the proxy: its lazily loaded extensions (replay, web
 * vitals) under `/static/`, and this project's remote config under `/array/<token>/`. Nothing
 * else on the proxy may run as script.
 */
export const POSTHOG_SCRIPT_SOURCES = [
  ANALYTICS_SITE.proxyHost + "/static/",
  ANALYTICS_SITE.proxyHost + "/array/" + ANALYTICS_SITE.projectToken + "/",
] as const;

/**
 * The one Content-Security-Policy every response carries. Beyond `'self'` it allows only the
 * artwork hosts (images); when analytics can run on this origin, the PostHog SDK's scripts and its
 * captures on the proxy; and the origin of the Bugsink DSN the server hands to browsers. With
 * analytics off (any origin but the registered production host, where the client never loads the
 * tracker) or no public DSN, those sources are absent. `new URL(...).origin` drops the DSN's key,
 * so the policy never carries it.
 */
export function contentSecurityPolicy(options: {
  readonly analytics: boolean;
  readonly bugsinkDsn: string | null;
}): string {
  const script = ["'self'"];
  const connect = ["'self'"];
  if (options.analytics) {
    script.push(...POSTHOG_SCRIPT_SOURCES);
    connect.push(ANALYTICS_SITE.proxyHost);
  }
  if (options.bugsinkDsn !== null)
    connect.push(new URL(options.bugsinkDsn).origin);
  return [
    "default-src 'self'",
    "script-src " + script.join(" "),
    "style-src 'self'",
    "img-src 'self' " +
      ARTWORK_HOSTS.map((host) => "https://" + host).join(" "),
    "connect-src " + connect.join(" "),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}
