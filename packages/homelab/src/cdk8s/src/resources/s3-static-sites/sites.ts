import type { StaticSiteConfig } from "../../misc/s3-static-site.ts";

// DNS records for all sites are managed by OpenTofu (src/tofu/cloudflare/).
export const staticSites: StaticSiteConfig[] = [
  { hostname: "sjer.red", bucket: "sjer-red" },
  { hostname: "webring.sjer.red", bucket: "webring" },
  { hostname: "resume.sjer.red", bucket: "resume" },
  { hostname: "discord-plays-pokemon.com", bucket: "dpp-docs" },
  { hostname: "scout-for-lol.com", bucket: "scout-frontend" },
  { hostname: "better-skill-capped.com", bucket: "better-skill-capped" },
  { hostname: "clauderon.com", bucket: "clauderon" },
  { hostname: "ts-mc.net", bucket: "ts-mc" },
];

export const S3_ENDPOINT = "https://seaweedfs.sjer.red";
export const S3_CREDENTIALS_SECRET_NAME = "seaweedfs-s3-credentials";
