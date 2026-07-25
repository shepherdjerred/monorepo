---
id: log-2026-06-07-birmel-ytdlp-rate-limit-fix
type: log
status: complete
board: false
---

# Birmel yt-dlp install — GitHub API rate-limit fix

## Problem

In CI (Buildkite/Dagger), the `docker-build-birmel` step intermittently failed during
dependency install:

```
node packages/birmel/node_modules/youtube-dl-exec/scripts/postinstall.js
Error: { "message": "API rate limit exceeded for <ip>. ... Authenticated requests get a higher rate limit." }
  at getBinary (.../youtube-dl-exec/scripts/postinstall.js:32:29)
```

### Root cause

`youtube-dl-exec`'s postinstall (`scripts/postinstall.js`) fetches the yt-dlp release
metadata from `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`
**unauthenticated**. Shared CI runners share an egress IP, so they exhaust GitHub's
**60 req/hr anonymous REST limit** and the build dies. The birmel Dagger image build
invoked this postinstall explicitly (`node node_modules/youtube-dl-exec/scripts/postinstall.js`).

Two relevant facts found while reading `youtube-dl-exec@3.1.x`:

- It reads the GitHub token env var (`GH_TOKEN` and its `GITHUB`-prefixed alias), **but**
  `getBinary` calls `fetch(url, headers)` instead of `fetch(url, { headers })`, so the
  `Authorization` header is silently dropped — passing a token would **not** reliably fix
  the API call (option 1 is unreliable without patching the package).
- The package's runtime only needs an executable at
  `node_modules/youtube-dl-exec/bin/yt-dlp` (`constants.YOUTUBE_DL_PATH`); it spawns that
  path. Any working yt-dlp executable is a valid drop-in.

The monorepo already had a **proven, rate-limit-proof precedent**: `withStreambotRuntime`
downloads yt-dlp from the release **asset CDN** (`releases/latest/download/...`, served
off the asset CDN — NOT subject to the `api.github.com` REST limit) with SHA verification.

## Fix

All in [`.dagger/src/image.ts`](../../../.dagger/src/image.ts):

1. **New shared helper `installYtDlp(container, destPath)`** — downloads the
   architecture-appropriate yt-dlp standalone binary (`yt-dlp_linux` /
   `yt-dlp_linux_aarch64`) from the release CDN, verifies it against the release's
   published `SHA2-256SUMS`, and `install -D -m 0755`s it to `destPath`. Adds curl
   retries (`--retry 5 --retry-all-errors --retry-delay 2`) to ride out transient blips.
   This is the existing streambot logic, extracted + parameterized + hardened.
2. **`withBirmelMusicRuntime`** now installs `curl` (needed to fetch the binary).
3. **birmel image branch** in `buildImageHelper` replaces
   `node .../postinstall.js` with
   `installYtDlp(image, "/workspace/packages/birmel/node_modules/youtube-dl-exec/bin/yt-dlp")`,
   keeping the existing `test -x` smoke check.
4. **`withStreambotRuntime`** refactored to call the same shared helper (DRY; also gains
   the retry hardening). Behavior unchanged — same asset, same SHA check, same
   `/usr/local/bin/yt-dlp` destination.

This corresponds to the task's preferred approach (avoid the rate-limited API path
entirely; option 2 + the CDN precedent), and the binary is fetched once per arch from the
CDN rather than the 60/hr REST endpoint.

## Verification

- `bunx tsc --noEmit -p .dagger/tsconfig.json` → clean (after `dagger develop` generated SDK)
- `bun scripts/check-dagger-hygiene.ts` → No violations
- `bunx prettier --check .dagger/src/image.ts` → OK
- **Actual Dagger build** of the birmel image:

  ```
  dagger call build-image --pkg-dir=../packages/birmel --pkg=birmel \
    --dep-names=eslint-config,llm-observability \
    --dep-dirs=../packages/eslint-config,../packages/llm-observability \
    with-exec --args=sh,-c,'test -x .../bin/yt-dlp && .../bin/yt-dlp --version && echo YT_DLP_OK' stdout
  ```

  Output: `yt-dlp_linux_aarch64: OK` (SHA verified) → `2026.03.17` (binary runs) →
  `YT_DLP_OK`. No `api.github.com` call, no rate-limit error.

## Session Log — 2026-06-07

### Done

- `.dagger/src/image.ts`: added `installYtDlp` helper; birmel now fetches yt-dlp from the
  release CDN (SHA-verified, retried) instead of the rate-limited `api.github.com`
  postinstall; added `curl` to `withBirmelMusicRuntime`; refactored `withStreambotRuntime`
  to reuse the helper.
- Verified via tsc, dagger-hygiene, prettier, and a real Dagger build of the birmel image.

### Remaining

- None. Reverted the incidental `dagger.json` engine-version bump that `dagger develop` made.

### Caveats

- The local build ran on arm64 (picked `yt-dlp_linux_aarch64`); CI is amd64 (will pick
  `yt-dlp_linux`). Both branches exist in the helper and are exercised by arch detection.
- `node` is still installed in `withBirmelMusicRuntime` (no longer needed for the
  postinstall, but kept for the package's runtime wrapper — out of scope to remove).
- Scope kept to birmel + the shared helper; discord-plays-mario-kart vendoring untouched.
