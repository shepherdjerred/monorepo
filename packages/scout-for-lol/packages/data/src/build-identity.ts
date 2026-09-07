/**
 * Placeholder value stamped for a build's version / gitSha / contractHash when
 * the real value is absent — local dev and pre-feature builds. The web
 * bundle's contract-mismatch check (`isContractMismatch` in the app's
 * build-info) treats this sentinel on *either* side as "no mismatch", so the
 * backend also returns it as the `contractHash` of `GET /api/version` for
 * sessions that must not see the owner-only mismatch diagnostic. Shared here
 * so the app and backend never drift on the literal.
 */
export const DEV_PLACEHOLDER = "dev";

const CANONICAL_RELEASE_VERSION = /^2\.0\.0-[1-9]\d*$/;
const BAKE_NUMBER = /^[1-9]\d*$/;

/**
 * Human-facing Scout version (`2.0.0-<build>`). Image bakes stamp the raw
 * Buildkite number as `VERSION`; site release state already carries the
 * canonical form. The archive digest (`scout-site@sha256:…`) stays the
 * Sentry/S3 identity and is not rewritten here — unknown strings pass
 * through so a mixed-generation owner diagnostic cannot crash.
 */
export function scoutReleaseVersion(raw: string): string {
  if (raw === DEV_PLACEHOLDER || CANONICAL_RELEASE_VERSION.test(raw)) {
    return raw;
  }
  if (BAKE_NUMBER.test(raw)) {
    return `2.0.0-${raw}`;
  }
  return raw;
}
