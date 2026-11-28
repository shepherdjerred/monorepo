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

/**
 * Cargo debuginfo for CI's `dev` and `test` profiles.
 *
 * Every Rust task in a workspace shares one `target/` on the workspace volume,
 * and full debuginfo (`debug = 2`) is copied into every linked test binary, so
 * it dominates the bytes verify writes. Workspace crates build with `limited`
 * (`debug = 1`), which keeps function names and `file:line` in panic
 * backtraces. Dependencies build with none: nothing in CI reads their DWARF,
 * and a backtrace still names their frames from the symbol table.
 *
 * Cargo reads a per-package profile override only from a config file, so the
 * dependency level is not a `CARGO_PROFILE_*` variable.
 * `CI_CARGO_DEPENDENCY_DEBUG` asks `ci/scripts/toolchain.sh` to write
 * `[profile.dev.package."*"]` into `$CARGO_HOME/config.toml`. The file binds CI
 * steps only, and main and pull requests write the same one, so `sccache` hits
 * carry across. `test` inherits the `dev` override. Strict env mode strips the
 * two `CARGO_PROFILE_*` variables, so each Rust package's `turbo.json` passes
 * them through on its cargo tasks. The root `turbo.json` is a global
 * verification input and must not name them.
 *
 * Do not lower the workspace level to `line-tables-only` without changing Scout
 * desktop's `proactive_boundary` test. It searches the built binary for
 * `speak_proactive_answer`, a name only DWARF function names carry, so the beta
 * positive control fails with line tables alone.
 *
 * Neither profile sets `debug` in any `Cargo.toml`, so these settings apply;
 * local builds do not see them. `test` inherits `dev` but is set explicitly
 * because a profile's own value wins. Release profiles are untouched.
 */
export const CARGO_CI_DEBUGINFO_ENVIRONMENT = {
  CARGO_PROFILE_DEV_DEBUG: "limited",
  CARGO_PROFILE_TEST_DEBUG: "limited",
  CI_CARGO_DEPENDENCY_DEBUG: "none",
} as const;

/** Marks a step whose Rust builds use the remote sccache WebDAV store. */
export const SCCACHE_WEBDAV_ENVIRONMENT = {
  RUSTC_WRAPPER: "sccache",
  CARGO_INCREMENTAL: "0",
  ...CARGO_CI_DEBUGINFO_ENVIRONMENT,
  SCCACHE_WEBDAV_ENDPOINT,
} as const;

/**
 * The same environment with remote sccache WebDAV disabled. The debuginfo level
 * stays: it shapes `target/` size, not the cache, and a cold benchmark should
 * measure the build CI actually runs.
 */
export function withoutSccacheWebdav(
  environment: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment ?? {}).filter(
      ([name]) =>
        !(name in SCCACHE_WEBDAV_ENVIRONMENT) ||
        name in CARGO_CI_DEBUGINFO_ENVIRONMENT,
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
