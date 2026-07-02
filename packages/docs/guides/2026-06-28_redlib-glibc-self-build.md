# Why the Homelab Self-Builds redlib (glibc Image)

## Status

Complete (PR #1147, 2026-06-13).

## Problem

redlib crashloops with `Failed to create OAuth client: 401 Unauthorized` ([redlib-org/redlib#551](https://github.com/redlib-org/redlib/issues/551)) because the published quay/`latest` image is **musl/Alpine**, and Reddit now blocks that TLS fingerprint during OAuth. redlib does OAuth spoofing, so there are NO user-suppliable Reddit credentials to rotate and bumping the image digest does nothing. The fix (confirmed in #551): build the **glibc `Dockerfile.ubuntu`** — same source, different libc, fingerprint passes.

## What we do instead of pulling quay

- `.dagger/src/image.ts` `buildRedlibImageHelper`/`pushRedlibImageHelper` build `dag.git("https://github.com/redlib-org/redlib.git").commit(REDLIB_SOURCE_REF).tree().dockerBuild({ dockerfile: "Dockerfile.ubuntu", platform: amd64 })`. `@func()` wrappers `buildRedlibImage`/`pushRedlibImage` in `index.ts`.
- `REDLIB_SOURCE_REF` in `.dagger/src/constants.ts` pins redlib **`main` HEAD** (NOT a tag — last release predates the fingerprint fixes). A `git-refs` custom manager in `renovate.json` advances it as main moves.
- Registered as an `INFRA_PUSH_TARGET` in `scripts/ci/src/catalog.ts` + added to the no-source build/push sets in `scripts/ci/src/steps/images.ts`. Version-commit-back fills `shepherdjerred/redlib` in `versions.ts`.
- homelab `redlib.ts` consumes `ghcr.io/shepherdjerred/redlib`.

## Post-merge gotcha

After CI first pushes the package, set `ghcr.io/shepherdjerred/redlib` to **public** in the GitHub UI (no API) — homelab has no imagePullSecret infra, so private → anonymous 401 → ImagePullBackOff. Confirm OAuth via redlib pod logs post-deploy.
