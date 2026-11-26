import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { GRADLE_BUILD_CACHE_USERS } from "#src/pipeline/gradle-build-cache.ts";

/**
 * WebDAV object cache for `sccache` hosted on first-party `ci-cache`.
 *
 * `SCCACHE_DIR` must remain unset when `SCCACHE_WEBDAV_ENDPOINT` is active so
 * `sccache` stores and fetches compiled Rust objects over WebDAV rather than a
 * pod-local or node-pinned directory. Authentication reuses the trust-domain
 * Basic Auth identities from `ci-gradle-build-cache-credentials`: pull requests
 * receive `ci-pull-request` (read-only) and trusted main/extended workflows
 * receive `ci-main` (read/write).
 */
const SCCACHE_WEBDAV_ENDPOINT = "https://ci-cache.tailnet-1a49.ts.net/sccache/";

const SCCACHE_WEBDAV_SECRET = "ci-gradle-build-cache-credentials";

type SccacheTrustDomain = "trusted" | "pull-request";

/** Marks a step whose Rust builds use the remote sccache WebDAV store. */
export const SCCACHE_WEBDAV_ENVIRONMENT = {
  RUSTC_WRAPPER: "sccache",
  CARGO_INCREMENTAL: "0",
  SCCACHE_WEBDAV_ENDPOINT,
} as const;

/** The same environment with remote sccache WebDAV disabled. */
export function withoutSccacheWebdav(
  environment: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment ?? {}).filter(
      ([name]) => !(name in SCCACHE_WEBDAV_ENVIRONMENT),
    ),
  );
}

function sccacheWebdavPassword(trustDomain: SccacheTrustDomain): SecretGrant {
  const { passwordKey } = GRADLE_BUILD_CACHE_USERS[trustDomain];
  return {
    secret: SCCACHE_WEBDAV_SECRET,
    key: passwordKey,
    env: "SCCACHE_WEBDAV_PASSWORD",
  };
}

/** Attach one trust domain's WebDAV Basic Auth identity to sccache steps. */
export function grantSccacheWebdav(
  steps: readonly CiStep[],
  trustDomain: SccacheTrustDomain,
): CiStep[] {
  return steps.map((step) => {
    if (step.environment?.["SCCACHE_WEBDAV_ENDPOINT"] === undefined)
      return step;
    return {
      ...step,
      environment: {
        ...step.environment,
        SCCACHE_WEBDAV_USERNAME: GRADLE_BUILD_CACHE_USERS[trustDomain].username,
      },
      secrets: [...(step.secrets ?? []), sccacheWebdavPassword(trustDomain)],
    };
  });
}
