---
id: log-2026-07-19-ci-green-main-infra-releaseplease
type: log
status: in-progress
board: false
---

# CI-green on main — infra bucket adoption + release-please transient retry

## Goal

`/goal get CI on main passing. don't cut quality.`

## What was red

Last **completed** main build was #5809 (passed, 19:46). Everything after was
canceled/superseded by rapid pushes until **build #5864** (HEAD `1e59abce3`, the
dotfiles-sync merge #1574) ran to completion and **failed**. Triage of 5864:

- `verify` ✅, `playwright e2e` ✅, `resume build` ✅, `docker e2e` ✅,
  `deploy sites` ✅, `npm publish` ✅, `helm push` ✅, `tofu apply (github)` ✅,
  `cooklang publish` ✅.
- `trivy` / `semgrep` failed but are `soft_fail: true` (live pipeline lines 364/381) → non-blocking.
- All "broken" steps (`helm types drift check`, `greptile`, PR dry-run lanes) are
  gated `build.branch != pipeline.default_branch` → correctly skipped on main.
- **Two hard failures sank the build:**
  1. `tofu apply (infra stacks)` — `creating S3 Bucket (scout-site-releases): BucketAlreadyExists`.
  2. `release-please` — GitHub **503** ("No server is currently available") PATCHing the release PR, exited **1** (should have been EXIT_TRANSIENT/34 → auto-retry).

## Root causes

1. **BucketAlreadyExists** — the `scout_site_releases` bucket resource landed on
   main in #5847 (`4ee03ee52`) **without an `import` block**; that build was
   canceled mid-apply after SeaweedFS had already auto-created the bucket on the
   first archive PutObject. The resource's own comment even anticipated "the
   stocks-style import-block adoption dance." seaweedfs is the **first** stack in
   the apply loop (`seaweedfs tailscale buildkite arr pagerduty`), so its failure
   aborted the whole step.
2. **Transient classifier blind to subprocess stderr** — `scripts/lib/run.ts`
   `run()` throws `Error("Command failed (exit N): <cmd>")` with only the command
   line; in non-capture mode the child's stderr was `inherit`ed (streamed, never
   captured). So `isTransientError` (`scripts/lib/transient.ts`, added by #1571)
   only ever saw the command line, never the "503 / Service Unavailable" text —
   #1571's retry could never fire for release-please/tofu/argocd subprocess errors.

## Fixes (PR fix/ci-green-infra)

- `packages/homelab/src/tofu/seaweedfs/buckets.tf` — add the `import { to =
aws_s3_bucket.scout_site_releases, id = "scout-site-releases" }` block
  (idiomatic; mirrors `stocks_sjer_red` / `relay_docs`). `tofu validate` ✅, `tofu fmt` ✅.
- `scripts/lib/run.ts` — pipe + **tee** stderr: forward every chunk live to the
  operator (concurrent drain → no pipe-buffer deadlock) while retaining a bounded
  16KiB tail in `RunResult.stderr`; `run()` embeds that tail in the thrown error
  so `isTransientError` can match subprocess-emitted 5xx/network signatures. Now
  a GitHub 503 during release-please classifies transient → exit 34 → auto-retry;
  `BucketAlreadyExists` stays a hard failure.
- `scripts/lib/run.test.ts` — 6 tests: stderr tail captured; tail embedded in
  thrown error; **503 subprocess → transient end-to-end**; BucketAlreadyExists →
  stays hard fail; live-forward preserved; large (200KB) stderr drains without
  deadlock and tail stays bounded.

## Verification (local)

- `bun test lib/run.test.ts lib/transient.test.ts` → 29 pass.
- `bunx turbo run typecheck test lint --filter=@shepherdjerred/root-scripts --filter=homelab` → 4/4 successful.
- `tofu fmt -check` exit 0; `tofu init -backend=false && tofu validate` → "The configuration is valid."
- eslint + prettier clean on changed files.

## Session Log — 2026-07-19

### Done

- Diagnosed build 5864's two hard failures; confirmed trivy/semgrep soft-fail and PR-lane steps branch-skipped on main.
- Added seaweedfs `scout_site_releases` import block; validated tofu.
- Fixed `run.ts` to tee+capture stderr into thrown errors so #1571's transient retry actually fires; added `run.test.ts`.

### Remaining

- Open PR `fix/ci-green-infra`, merge to main, watch the resulting main build's `tofu apply (infra stacks)` (adopts bucket) and `release-please` (503 was transient / now auto-retries) go green.
- After first successful apply, the import block may be removed (no-op once in state) — optional cleanup, not required.

### Caveats

- The `import` block is a no-op only if the live bucket is `scout-site-releases`; confirmed by the 5864 error string. Import is non-destructive (adopts, never recreates).
- `run.ts` now userspace-forwards stderr instead of OS-inherit; live streaming preserved, but stdout (OS-inherited) and stderr may interleave slightly differently in a combined terminal (Buildkite merges by timestamp). No functional impact.
