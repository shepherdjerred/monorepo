---
id: log-2026-06-13-redlib-mcp-gateway-health
type: log
status: complete
board: false
---

# redlib + mcp-gateway health — 2026-06-13

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

## Session Log — 2026-06-13

### Done

- Diagnosed both workloads to root cause (redlib musl OAuth block #551; mcp-gateway empty `FASTMAIL_TOKEN`/`GMAIL_TOKEN` 1Password fields).
- Implemented redlib self-built glibc image end-to-end on `feature/redlib-glibc-image` (commit `9941e9b7c`): Dagger build/push funcs, `REDLIB_SOURCE_REF` pin, CI catalog + steps, homelab `versions.ts`/`redlib.ts`, Renovate git-refs manager.
- Verified: `dagger call build-redlib-image` builds; CI generator emits redlib steps; scripts/ci + homelab typecheck; 237 ci tests; eslint/prettier/dagger-hygiene/markdownlint clean; Renovate regex matches.
- Opened PR [#1147](https://github.com/shepherdjerred/monorepo/pull/1147); wrote this log (`f4df95383`); added memory `reference_redlib_glibc_image`.

### Remaining

- **redlib:** merge #1147 → CI pushes `ghcr.io/shepherdjerred/redlib` → **set the ghcr package Public** (GitHub UI) → version-commit-back PR merges → ArgoCD deploys. Confirm OAuth via redlib pod logs.
- **mcp-gateway:** user to populate the two empty 1Password fields (see above), then verify pod goes `Running` (operator re-sync is automatic).

### Caveats

- redlib `versions.ts` seed digest is a placeholder (`sha256:000…`) until CI's first commit-back; the first deploy may briefly ImagePullBackOff and self-heals next pipeline.
- Runtime OAuth not confirmed locally — local Dagger engine flakiness (see Workflow Friction), not a code issue.
- redlib source tracks `main` HEAD (Renovate git-refs), so future redlib commits will open rebuild PRs; a broken upstream commit fails CI and stays unmerged (prod keeps last-good).

## Workflow Friction

- The local Dagger engine (`dagger v0.21.6`, engine container "Up 18h") reliably **builds** images but drops the connection — `Error: Post "http://dagger/query": unexpected EOF` — on **every** follow-on `with-exec … stdout`, `export-image`, and `as-tarball`. This made local runtime/image verification (e.g. running redlib to confirm OAuth, `docker load`-ing the image) impossible; only `dagger call build-redlib-image` (no output streaming) succeeded. Restarting the engine container (`docker restart dagger-engine-v0.21.6`) is the likely fix for a future session that needs local image runtime checks.
