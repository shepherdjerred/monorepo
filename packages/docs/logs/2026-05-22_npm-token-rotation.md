---
id: log-2026-05-22-npm-token-rotation
type: log
status: complete
board: false
---

# npm token rotation + Dagger publish precheck

## Summary

Main CI had been red since build #2630 (2026-05-21) on three npm publish jobs
(`astro-opengraph-images`, `webring`, `@shepherdjerred/helm-types`), each hanging
~5 minutes per build in `bun publish`'s interactive web-auth fallback. Root cause
was npm's platform-wide invalidation of all granular tokens that bypass 2FA on
2026-05-20 (Mini Shai Hulud worm response). The replacement `NPM_TOKEN` written
to the 1Password `Buildkite CI Secrets` item on 2026-05-21 had `bypass_2fa:false`
because the "Bypass two-factor authentication (2FA)" checkbox on npm's
granular-token-create page was grayed out; npm now requires a WebAuthn-authenticated
session (not just enrollment) before that option becomes available.

Resolved by signing out of npm and signing back in with the passkey, then minting
a fresh granular token with bypass-2FA enabled, rotating it into the 1P item
(K8s `buildkite-ci-secrets` synced automatically via the OnePasswordItem
controller), and retrying the three failed publish jobs in build #2644 — all
three passed end-to-end.

A fail-fast precheck landed in [.dagger/src/release.ts](../../../.dagger/src/release.ts)
so the next time a token doesn't bypass 2FA, the publish step exits in ~1 second
with an actionable error message instead of hanging the full Buildkite 5-min
timeout per package.

## Timeline

| Date (UTC)              | Event                                                          |
| ----------------------- | -------------------------------------------------------------- |
| 2026-05-17T21:08        | Build #2572 — last passing main build                          |
| 2026-05-20              | npm invalidates all bypass-2FA granular tokens (Shai Hulud)    |
| 2026-05-21T05:26        | New granular token written to 1P, `bypass_2fa: false`          |
| 2026-05-21 → 2026-05-22 | Builds #2630, #2632, #2635, #2640, #2644 all red on publishes  |
| 2026-05-22T19:28        | New bypass-2FA token minted via WebAuthn-authenticated session |
| 2026-05-22T19:34        | Build #2644 publish retries pass                               |

## Findings

- **Failure signature:** `bun publish` after packing the tarball prints
  `Authenticate your account at: https://www.npmjs.com/auth/cli/<id>` and polls
  `/-/v1/done?authId=…` for ~5 min before timing out. `npm publish` surfaces
  the same condition as `npm error code EOTP — This operation requires a one-time password.`
- **Why `--tolerate-republish` previously masked this:** the flag short-circuits
  before any auth-required request when the target version already exists, so
  failures only surface for net-new dev versions (every commit).
- **Why the bypass-2FA checkbox was grayed out:** npm's post-Shai-Hulud security
  policy gates bypass-2FA token creation on the _session's_ 2FA method. Long-standing
  passkey enrollment is not sufficient — the active session must have been
  authenticated via the passkey (not TOTP). Signing out and back in with the
  passkey ungrays the checkbox.
- **Classic Automation tokens are retired** (npm removed them Dec 2025).
  Granular access tokens are the only path forward.
- **Granular write tokens are capped at 90 days max, default 7.** This rotation
  is permanent and recurring — expect it ~every 90 days.
- **Trusted Publishing (OIDC) is not supported on Buildkite** as of 2026-05.
  npm only allows GitHub Actions / GitLab CI / CircleCI. Self-hosted runners
  explicitly excluded. A Buildkite engineer publicly confirmed they're trying
  to get added. Workaround if we ever want OIDC: trigger a minimal GHA reusable
  workflow from Buildkite that does only `npm publish`.
- **Staged publishing went GA 2026-05-22.** CI queues the publish, a maintainer
  approves from the website. Alternative long-term path that doesn't need
  bypass-2FA tokens at all.

## Changes

- [.dagger/src/release.ts](../../../.dagger/src/release.ts) `publishNpmHelper` —
  added a precheck step before `bun publish` that calls
  `/-/npm/v1/tokens`, locates the current token by its truncated
  `<prefix>...<suffix>` form, and fails fast with an actionable error if
  `bypass_2fa` is false. Adds ~200ms per publish on the happy path; saves
  ~5min × N packages of CI hang on the failure path.
- 1Password item `vaults/v64ocnykdqju4ui6j6pua56xw4/items/rzk3lawpk4yspyyu5rxlz44ssi`
  `NPM_TOKEN` field — rotated to a granular token with `bypass_2fa: true`,
  expiring 2026-08-20.

## Other CI failures (still red on main, out of scope this session)

Build #2644 remains failed because of two unrelated issues observed during the
same diff-read:

- **Wait for ArgoCD Healthy (apps)** — the shell loop in `argoCdHealthWaitHelper`
  uses `curl -sf` which silently swallows the HTTP error body, producing
  `jq: parse error: Invalid numeric literal at line 1, column 3` against an
  empty response. Likely 401 from a missing/bad `ARGOCD_TOKEN`.
- **Version Commit-Back** — `git push` from `versionCommitBackHelper` fails
  with `remote: No anonymous write access. fatal: Authentication failed`
  followed by `gh` 401, despite the GitHub App token mint succeeding upstream
  (per [7bbd6f8ea](https://github.com/shepherdjerred/monorepo/commit/7bbd6f8ea)).
  `GIT_ASKPASS` is wired but the token reaching the askpass shell may be empty
  or malformed.

Knip and Trivy continue to soft-fail per the active CI quality hardening plan;
those are not real blockers.

## Session Log — 2026-05-22

### Done

- Reproduced the publish hang locally with bun 1.3.14 + a 2FA-required token
  on a new version of `webring` — identical UX to CI (`bun publish` waits
  forever on `https://www.npmjs.com/auth/cli/<id>`).
- Confirmed via `npm publish` that the real error is `EOTP`, not a bun bug.
- Spawned a research agent that surfaced npm's 2025-09-29 TOTP-phaseout
  changelog, the May-2026 bypass-2FA WebAuthn-session requirement, and
  Buildkite's lack of OIDC trusted-publisher support.
- Rotated `NPM_TOKEN` in 1Password to a bypass-2FA token; verified K8s
  `buildkite-ci-secrets` synced.
- Retried the three failed publish jobs in build #2644 — all passed.
- Added a precheck guard to [.dagger/src/release.ts](../../../.dagger/src/release.ts)
  so future bad rotations fail in seconds instead of minutes.
- Saved reference memory for the next 90-day rotation cycle.

### Remaining

- ArgoCD wait + version commit-back failures (see above). Each has a clear
  root-cause hypothesis but is a separate scope.
- Long-term: evaluate staged publishing or a GHA-reusable-workflow proxy so
  we stop having to manage bypass-2FA tokens every 90 days.

### Caveats

- The precheck calls `https://registry.npmjs.org/-/npm/v1/tokens` from the
  publish container; if that endpoint becomes unavailable, all publishes fail.
  Acceptable trade-off vs. the 5-min hang.
- The token introspection response identifies tokens by a truncated
  `<prefix>...<suffix>` form. If npm changes that format, the precheck's
  matching logic needs an update.
- The new token expires 2026-08-20 — set a reminder; rotation is irreducible.

<!-- temporal-agent-task
{
  "title": "Verify npm publish CI is still green ahead of NPM_TOKEN expiry",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-08-13T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/logs/2026-05-22_npm-token-rotation.md"
  },
  "prompt": "The current granular NPM_TOKEN (1Password item rzk3lawpk4yspyyu5rxlz44ssi, NPM_TOKEN field) expires 2026-08-20. Confirm whether (a) the latest `:npm: Publish *` Buildkite jobs on main are still passing the bypass-2FA precheck, and (b) a fresh bypass-2FA replacement has been minted ahead of expiry. Email yes/no with links/evidence; do NOT mint a token yourself."
}
-->

<!-- temporal-agent-task
{
  "title": "Re-evaluate npm Trusted Publishing for Buildkite",
  "provider": "claude",
  "mode": "report-only",
  "cron": "0 9 1 */3 *",
  "scheduleId": "npm-trusted-publishing-buildkite-check",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/logs/2026-05-22_npm-token-rotation.md"
  },
  "prompt": "Check whether npm has added Buildkite to the Trusted Publishers OIDC allowlist (https://docs.npmjs.com/trusted-publishers) or whether self-hosted-runner support has landed. If yes, propose a migration that removes the 90-day bypass-2FA token rotation; otherwise email a short status update."
}
-->
