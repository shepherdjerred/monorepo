import { ARTWORK_HOSTS } from "@shepherdjerred/streambot/metadata/public-artwork.ts";
import { ANALYTICS_SITE } from "@shepherdjerred/streambot/web/shared/analytics-site.ts";

/**
 * The one Content-Security-Policy every response carries. Beyond `'self'` it allows only the
 * artwork hosts (images), the PostHog proxy (the analytics SDK and its lazily loaded replay and
 * web-vitals scripts, and their captures), and the Bugsink origin of the DSN the server hands to
 * browsers. With no DSN configured there is no Bugsink origin at all. `new URL(...).origin`
 * drops the DSN's key, so the policy never carries it.
 */
export function contentSecurityPolicy(bugsinkDsn: string | null): string {
  const connect = ["'self'", ANALYTICS_SITE.proxyHost];
  if (bugsinkDsn !== null) connect.push(new URL(bugsinkDsn).origin);
  return [
    "default-src 'self'",
    "script-src 'self' " + ANALYTICS_SITE.proxyHost,
    "style-src 'self'",
    "img-src 'self' " +
      ARTWORK_HOSTS.map((host) => "https://" + host).join(" "),
    "connect-src " + connect.join(" "),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}
