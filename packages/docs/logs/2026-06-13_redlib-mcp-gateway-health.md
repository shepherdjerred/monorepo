# redlib + mcp-gateway health — 2026-06-13

## Status

Partially Complete — redlib fix implemented on `feature/redlib-glibc-image` (PR pending merge → CI build/push → ArgoCD deploy); mcp-gateway fix waiting on user-supplied credentials.

## Problem

Two unhealthy workloads on the cluster:

| Workload    | Symptom                                                                                            | Root cause                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| redlib      | `CrashLoopBackOff`, `Failed to create OAuth client: 401 Unauthorized`                              | Published quay image is **musl/Alpine**, whose TLS fingerprint Reddit now blocks during OAuth ([redlib-org/redlib#551](https://github.com/redlib-org/redlib/issues/551)). Already on the newest published musl digest, so a bump can't help. |
| mcp-gateway | `CreateContainerConfigError`: `couldn't find key FASTMAIL_TOKEN in Secret mcp-gateway-credentials` | 1Password item `mcp-gateway-credentials` has `FASTMAIL_TOKEN` + `GMAIL_TOKEN` fields but they are **empty**, so the operator drops them from the synced secret. One missing key blocks the whole pod.                                        |

## redlib fix — build our own glibc image

Decision (user-approved): build redlib from upstream's glibc `Dockerfile.ubuntu` ourselves and publish to ghcr, rather than use the blocked musl image or a third-party rebuild. The OAuth break is purely the libc/TLS stack — same source built with glibc works (confirmed by multiple users in #551).

Source is pinned to redlib **`main` HEAD** (`a4d36e954cf1…`), not a tag: the last GitHub release `v0.36.0` (2025-03) predates the fingerprint fixes, and the numerically-newest tag `v3.0.0` is a 2021 libreddit-era relic. Renovate's git-refs manager advances the pin as `main` moves.

Files (commit `9941e9b7c`):

- `.dagger/src/constants.ts` — `REDLIB_SOURCE_REF` pin + Renovate annotation
- `.dagger/src/image.ts` — `buildRedlibImageHelper` (`git().commit(ref).tree().dockerBuild({dockerfile:"Dockerfile.ubuntu", platform: amd64})`) + `pushRedlibImageHelper`
- `.dagger/src/index.ts` — `buildRedlibImage` / `pushRedlibImage` `@func()` wrappers
- `scripts/ci/src/catalog.ts` — redlib added to `INFRA_PUSH_TARGETS`
- `scripts/ci/src/steps/images.ts` — `build-redlib-image` / `push-redlib-image` added to the no-source build/push sets
- `packages/homelab/.../versions.ts` — key `redlib/redlib` → `shepherdjerred/redlib` (placeholder seed digest; CI commit-back fills it)
- `packages/homelab/.../resources/frontends/redlib.ts` — image → `ghcr.io/shepherdjerred/redlib`
- `renovate.json` — git-refs custom manager for `REDLIB_SOURCE_REF`

### Verification

- `dagger call build-redlib-image` — glibc image builds end-to-end (Rust compile + image assembly).
- `dagger functions` lists `build-redlib-image` / `push-redlib-image` (module loads cleanly).
- CI generator emits `build-redlib` / `push-redlib` / `digest:shepherdjerred/redlib` when homelab changes.
- `scripts/ci` typecheck + 237 tests pass; homelab typecheck + eslint-homelab pass; prettier + dagger-hygiene pass.
- Renovate git-refs regex matches the constants.ts line (branch=main, digest captured); the generic constants manager does **not** double-match it.
- Runtime OAuth confirmation was attempted locally but the local Dagger engine repeatedly dropped the connection (`Post http://dagger/query: unexpected EOF`) on post-build exec/export — not a redlib/code issue. Runtime OAuth success is backed by the #551 consensus and must be confirmed post-deploy.

## mcp-gateway fix — populate credentials

User chose to provide the tokens. Two empty fields in 1Password item `iixelnobjabehkgxhl3ekacdy4` (vault `v64ocnykdqju4ui6j6pua56xw4`) need values:

- `FASTMAIL_TOKEN` — Fastmail JMAP API token (Settings → Privacy & Security → API tokens, Mail read).
- `GMAIL_TOKEN` — Gmail App Password (Google Account → Security → App passwords → Mail), used as the IMAP password for `shepherdjerred@gmail.com`.

```
op item edit iixelnobjabehkgxhl3ekacdy4 --vault v64ocnykdqju4ui6j6pua56xw4 FASTMAIL_TOKEN='…' GMAIL_TOKEN='…'
```

Once set, the 1Password operator re-syncs the secret (adds the two keys) and the pod recovers on its next retry (or `kubectl rollout restart deployment/mcp-gateway -n mcp-gateway`). No code change required.
