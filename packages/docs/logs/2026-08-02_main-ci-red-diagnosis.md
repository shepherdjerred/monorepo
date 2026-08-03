---
id: main-ci-red-diagnosis-2026-08-02
type: log
status: complete
board: false
---

# Main CI Red — Diagnosis (2026-08-02)

## Question

Why is Buildkite red on `main`?

## Findings

### Build #7667 (`93cc4a16d`, latest) — release-refiner Zod schema rejects `api_error_status: null`

- The only hard failure is `:package: release-please` (exit 1). Everything else
  red in the build is collateral: `:docker: images` was killed by the build
  cancellation signal one second before the build finished
  (cancel-on-build-failing), and the whole deploy train
  (deploy sites, helm push, tofu applies, argo sync, scout releases,
  version commit-back) went `waiting_failed`. **The image bumps in #1925 never
  deployed.**
- The Claude CHANGELOG refiner itself **succeeded** — it refined release PR
  #1921 (astro-opengraph-images 1.18.0, webring 1.8.0, helm-types 1.6.0,
  commit `9fbe588bcee215952cfecb8e91fbadd6ec513e30`) and its result JSON shows
  `"is_error": false` with a full success envelope.
- `runReleaseRefiner` still threw
  `Claude release refiner exited 0 without a valid non-error JSON result`
  (`scripts/lib/release-refiner.ts:405`) because `parseClaudeResult` returned
  `null`: the CLI result JSON contains `"api_error_status": null`, but
  `ClaudeResultSchema` (`scripts/lib/release-refiner.ts:12-18`) declares
  `api_error_status: z.number().optional()` — `.optional()` permits an absent
  key, not an explicit `null`. Reproduced locally:
  `safeParse` fails with `invalid_type: expected number, received null`.
- This is a **latent bug, not a regression** from the #1925 image bump: build
  #7654's refiner section logged `[]` open release PRs → `provider=none`, so
  #7667 was the first build to exercise the Claude _success_ path. The test
  fixtures (`scripts/lib/release-refiner.test.ts`) only cover
  `api_error_status: 429` (the quota-fallback path); no fixture has a success
  result with `api_error_status: null`.
- **Every future `main` build will fail the same way** while release PR #1921
  is open, until the schema accepts `null`
  (e.g. `z.number().nullable().optional()`).

### Builds #7605 / #7621 / #7654 — `:argo: sync + wait` on `media` (now resolved)

- All three failed syncing the `media` app:
  `Deployment.apps "media-qbittorrent" is invalid:
spec.template.spec.containers[1].{liveness,readiness,startup}Probe.tcpSocket:
Forbidden: may not specify more than 1 handler type`.
- PR #1841 (`5c74e57e5`, merged 2026-07-31) inserted the `shelfbridge-relay`
  container (tcpSocket probes on 8404) at index 1; the strategic-merge patch
  against the live deployment produced probes carrying two handler types.
- **Resolved before this session**: a manual `admin`-initiated ArgoCD sync at
  2026-08-02T23:50:04Z succeeded; `media` is now Synced/Healthy at chart
  `2.0.0-7654`, and the live deployment shows the desired tcpSocket-only
  probes.

## Remaining work (not done this session — diagnosis only)

1. ~~Fix `ClaudeResultSchema.api_error_status` to accept `null`~~ — **PR #1920
   already exists** (`fix/release-refiner-api-error-null`, opened 2026-08-02
   19:22Z by an earlier session that hit the same failure on build #7574). Its
   fix is correct: `z.number().nullish()` + test fixtures + diagnosis docs.
2. **PR #1920 is blocked by CI infrastructure, not by its content.** Both of
   its builds (#7632, #7679) died at the very first `:pipeline: Upload
pipeline` step with exit `-7`: the git-mirrors alternate on the CI agent is
   broken (`error: unable to normalize alternate object path:
/buildkite/git-mirrors/https---github-com-shepherdjerred-monorepo-git/objects`),
   so `upload-pipeline.sh`'s fetch pulls the full ~693 MiB / 106k-object
   history, and the container stops responding mid-`Resolving deltas`
   (Buildkite: "Perhaps the container was OOM-killed?"). This is hitting
   **most PR builds** since ~22:40Z (#7670–#7681 mostly failed at upload; a
   few passed, so it is load-dependent, likely OOM under concurrent fetches).
3. Get a green build on PR #1920 (retry upload; if it keeps dying, fix the
   git-mirrors volume / upload-step memory), pass the review gate, merge, then
   confirm the next `main` build ships the pending #1925 image bumps
   (currently undeployed).

## Session Log — 2026-08-02

### Done

- Diagnosed both distinct `main` failures (release-refiner schema bug in
  #7667; qbittorrent probe merge conflict in #7605–#7654).
- Verified the schema rejection with a local zod repro; verified the argo
  issue is already resolved live (media Synced/Healthy, correct probes).

### Remaining

- Apply the one-line schema fix + test fixture (see above); rerun main.

### Caveats

- The refiner already pushed the refined CHANGELOG commit to PR #1921 even
  though the CI step failed — re-running the step should be idempotent, but
  the remote-verification path (`verifyReleaseRefinerResult`) will check the
  head commit, so don't hand-edit PR #1921 before the fix lands.
