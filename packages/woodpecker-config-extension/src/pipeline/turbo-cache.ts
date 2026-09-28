import type { SecretGrant } from "#src/pipeline/model.ts";

/** CI uses the same private cache namespace as developer machines. */
export const TURBO_REMOTE_CACHE_ENVIRONMENT = {
  TURBO_API: "https://turbo-cache.tailnet-1a49.ts.net",
  TURBO_TEAM: "monorepo",
} as const;

export const TURBO_CACHE_TOKEN: SecretGrant = {
  secret: "ci-turbo-cache-credentials",
  key: "TURBO_TOKEN",
  env: "TURBO_TOKEN",
};
