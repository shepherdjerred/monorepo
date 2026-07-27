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
