# npm granular token rotation (NPM_TOKEN for CI publishes)

## Status: Reference

The `NPM_TOKEN` used by Buildkite CI for npm publishes is stored in 1Password by the homelab operator and synced into the cluster by the OnePasswordItem controller (see [K8s sync](#k8s-sync) below). Rotation is recurring (~every 90 days) and has several non-obvious traps.

## Gotchas

- **bypass-2FA requires a WebAuthn-authenticated session.** Having a passkey enrolled isn't enough — the _current browser session_ must have been authenticated via the passkey (not TOTP). If the "Bypass two-factor authentication (2FA)" checkbox is grayed out on the granular-token-create page, fully sign out (https://www.npmjs.com/logout), sign back in choosing the passkey, then return to the token page.
- **Classic Automation tokens are retired** (npm removed them Dec 2025); granular access tokens are the only option.
- **Granular write tokens cap at 90 days (default 7).** Set the 90-day max for the longest-lived token.
- **OIDC / Trusted Publishing is NOT supported on Buildkite** (only GitHub Actions / GitLab CI / CircleCI as of 2026-05; self-hosted runners excluded). Workaround if ever needed: a tiny GHA reusable workflow triggered from Buildkite that only runs `npm publish`.
- npm has force-invalidated bypass-2FA granular tokens platform-wide before (2026-05-20, in response to the Mini Shai Hulud worm) — expect it may recur.

## Verify after rotating

```bash
curl -sS -H "Authorization: Bearer $NEW_TOKEN" https://registry.npmjs.org/-/npm/v1/tokens
# confirm the matching entry has "bypass_2fa": true
```

Without bypass, `bun publish` / `npm publish` hangs ~5min per package on npm's interactive web-auth fallback.

## K8s sync

The `buildkite-ci-secrets` Secret (`buildkite` namespace) is rendered by the OnePasswordItem controller. After the 1P update:

```bash
kubectl get secret buildkite-ci-secrets -n buildkite -o jsonpath='{.data.NPM_TOKEN}' | base64 -d
```

should show the new token within seconds.

## CI safety net

`.dagger/src/release.ts` `publishNpmHelper` runs a precheck that fails fast (with an actionable message) if the token doesn't bypass 2FA — saves ~15min of CI hang per publish job on a bad rotation.
