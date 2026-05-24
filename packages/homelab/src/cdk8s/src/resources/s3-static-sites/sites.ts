import type { StaticSiteConfig } from "@shepherdjerred/homelab/cdk8s/src/misc/s3-static-site.ts";

// DNS records for all sites are managed by OpenTofu (src/tofu/cloudflare/).
export const staticSites: StaticSiteConfig[] = [
  {
    hostname: "sjer.red",
    bucket: "sjer-red",
    probes: [{ endpoint: "rss", path: "/rss.xml", module: "rss_2xx" }],
  },
  { hostname: "webring.sjer.red", bucket: "webring" },
  { hostname: "resume.sjer.red", bucket: "resume" },
  { hostname: "discord-plays-pokemon.com", bucket: "dpp-docs" },
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
  },
  {
    hostname: "scout-for-lol-beta.sjer.red",
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
  },
  { hostname: "better-skill-capped.com", bucket: "better-skill-capped" },
  { hostname: "clauderon.com", bucket: "clauderon" },
  { hostname: "ts-mc.net", bucket: "ts-mc" },
  { hostname: "cook.sjer.red", bucket: "cook" },
];

export const S3_ENDPOINT = "https://seaweedfs.sjer.red";
export const S3_CREDENTIALS_SECRET_NAME = "seaweedfs-s3-credentials";
