# Scout-app ImagePullBackOff — root cause

## Status

Complete — fix shipped via [2026-05-24_scout-app-s3-caddy-migration.md](../plans/2026-05-24_scout-app-s3-caddy-migration.md) (option 2: remove the Deployment and serve the SPA from the shared `s3-static-sites` Caddy + bucket pattern).

## Summary

Both `scout-app-beta` (ns `scout-beta`) and `scout-app-prod` (ns `scout-prod`)
have been in `ImagePullBackOff` for 12h+. The backend pods (`scout-*-scout-backend`)
are healthy.

## Root cause

The image `ghcr.io/shepherdjerred/scout-app:0.0.1-dev` does not exist on ghcr.io.

- `gh api /users/shepherdjerred/packages/container/scout-app` → 404 (package not found).
- Anonymous registry token request returns `NAME_UNKNOWN` for the repository.
- Kubelet event: `failed to authorize: failed to fetch anonymous token: ... 403 Forbidden`.

The `0.0.1-dev` value in `packages/homelab/src/cdk8s/src/versions.ts:120` and `:122`
is a placeholder that was never replaced. The matching comment says the beta tag
is "updated by version-commit-back", which only fires after a successful image
build + push.

The `scout-app` image (Caddy + React SPA front, `packages/scout-for-lol/packages/app/Dockerfile`)
is **not** in the CI image catalog — `scripts/ci/src/catalog.ts` only ships the
backend (`scout-for-lol`) and a separate `scout-frontend` static-bucket target.
So nothing has ever built or pushed `ghcr.io/shepherdjerred/scout-app:*`.

History: the web UI deployment was introduced in `8747bf4d3 feat(scout-for-lol): web UI foundation at scout-for-lol.com/app/`
with follow-up `b9a0d476f`. The cdk8s deployment + versions pin landed, but the
image-build pipeline entry was never added.

## Fix options

1. **Add `scout-app` to the CI image catalog** (`scripts/ci/src/catalog.ts`) so
   Dagger builds and pushes it; version-commit-back will then update the beta pin
   automatically. This is the consistent path with the other services.
2. **Remove the `scout-app` deployment** from cdk8s if the SPA is being served
   by the existing `scout-frontend` static-bucket path instead. Right now both
   serving paths appear to coexist by accident.

## Session Log — 2026-05-24

### Done

- Identified the two failing pods in `scout-beta` / `scout-prod`.
- Confirmed `ghcr.io/shepherdjerred/scout-app` doesn't exist on ghcr.io (404 via gh api; `NAME_UNKNOWN` anonymously).
- Traced the `0.0.1-dev` placeholder to [versions.ts:120,122](packages/homelab/src/cdk8s/src/versions.ts:120) and confirmed no CI step in [catalog.ts](scripts/ci/src/catalog.ts) builds/pushes `scout-app`.
- Identified `8747bf4d3` as the commit that introduced the deployment without wiring up the build.

### Remaining

- Decide between option 1 (wire up the build) or option 2 (delete the deployment) and execute.

### Caveats

- Backend pods are unaffected; the user-visible impact is the `scout-for-lol.com/app/` SPA + reverse-proxy path being down. If users are still reaching the SPA, it's via the separate `scout-frontend` static-bucket target.
