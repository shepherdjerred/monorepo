import type { StaticSiteConfig } from "@shepherdjerred/homelab/cdk8s/src/misc/s3-static-site.ts";

/**
 * CSP for the scout-for-lol web UI (`/app/`).
 *
 * - `script-src 'self'` is satisfied because the first-paint dark-mode setup
 *   was extracted into `/app/init-theme.js` (see scout `app/index.html`).
 * - `img-src` allows `https://cdn.discordapp.com` for guild icons, `data:` for
 *   inlined icons, and `blob:` for chart PNGs fetched with credentials and
 *   rendered via `URL.createObjectURL` (see `app/src/components/chart-image.tsx`).
 * - `form-action 'self' https://discord.com` covers the
 *   `/api/auth/discord/start` → `discord.com/oauth2/authorize` redirect chain.
 * - `frame-ancestors 'none'` blocks clickjacking; this matches the
 *   `X-Frame-Options: DENY` default.
 */
const scoutCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://cdn.discordapp.com data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://discord.com",
].join("; ");

// DNS records for all sites are managed by OpenTofu (src/tofu/cloudflare/).
export const staticSites: StaticSiteConfig[] = [
  {
    hostname: "sjer.red",
    bucket: "sjer-red",
    probes: [{ endpoint: "rss", path: "/rss.xml", module: "rss_2xx" }],
    // sjer.red is HTTPS-everywhere via Cloudflare Tunnel for every site under
    // it, so lock the whole zone with includeSubDomains. Browsers honor this
    // header when served from the apex.
    responseHeaders: {
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    },
  },
  { hostname: "webring.sjer.red", bucket: "webring" },
  { hostname: "resume.sjer.red", bucket: "resume" },
  {
    hostname: "scout-for-lol.com",
    bucket: "scout-frontend",
    reverseProxies: [
      {
        path: "/api/healthz",
        upstream: "scout-service-prod.scout-prod.svc.cluster.local:3000",
        rewriteTo: "/healthz",
      },
      {
        path: "/trpc*",
        upstream: "scout-service-prod.scout-prod.svc.cluster.local:3000",
      },
      {
        path: "/api/*",
        upstream: "scout-service-prod.scout-prod.svc.cluster.local:3000",
      },
    ],
    probes: [
      { endpoint: "app", path: "/app/", module: "http_2xx" },
      { endpoint: "healthz", path: "/api/healthz", module: "http_2xx" },
    ],
    spaFallbacks: [{ pathPrefix: "/app/*", fallbackPath: "/app/index.html" }],
    responseHeaders: { "Content-Security-Policy": scoutCsp },
  },
  {
    hostname: "beta.scout-for-lol.com",
    bucket: "scout-frontend-beta",
    reverseProxies: [
      {
        path: "/api/healthz",
        upstream: "scout-service-beta.scout-beta.svc.cluster.local:3000",
        rewriteTo: "/healthz",
      },
      {
        path: "/trpc*",
        upstream: "scout-service-beta.scout-beta.svc.cluster.local:3000",
      },
      {
        path: "/api/*",
        upstream: "scout-service-beta.scout-beta.svc.cluster.local:3000",
      },
    ],
    probes: [
      { endpoint: "app", path: "/app/", module: "http_2xx" },
      { endpoint: "healthz", path: "/api/healthz", module: "http_2xx" },
    ],
    spaFallbacks: [{ pathPrefix: "/app/*", fallbackPath: "/app/index.html" }],
    responseHeaders: { "Content-Security-Policy": scoutCsp },
  },
  { hostname: "better-skill-capped.com", bucket: "better-skill-capped" },
  { hostname: "clauderon.com", bucket: "clauderon" },
  { hostname: "ts-mc.net", bucket: "ts-mc" },
  { hostname: "ppl.glitter-boys.com", bucket: "glitter-boys-ppl" },
  { hostname: "cook.sjer.red", bucket: "cook" },
  { hostname: "stocks.sjer.red", bucket: "stocks-sjer-red" },
  // Public artifact host. PR screenshots are served from the `pr/assets/<n>/`
  // prefix; uploads go through `toolkit pr asset`.
  { hostname: "public.sjer.red", bucket: "public-sjer-red" },
];

export const S3_ENDPOINT = "https://seaweedfs.sjer.red";
export const S3_CREDENTIALS_SECRET_NAME = "seaweedfs-s3-credentials";
