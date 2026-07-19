---
id: log-2026-07-10-pr-1438-quality-wave-1-babysit
type: log
status: complete
board: false
---

# PR #1438 — Quality Hardening Wave 1: Babysit to Green

## Context

Shepherding PR #1438 (branch `feature/quality-wave-1`) to a fully green,
mergeable state: CI green (minus soft-fail Trivy/Knip), no P3+ review comments,
no real merge conflicts with main. Work done in the worktree
`.claude/worktrees/quality-wave-1`.

## Findings on entry

- **Merge conflicts:** none. The GitHub `mergeable` field / toolkit cache is not
  trusted here — verified by `git fetch origin main` + `git merge-tree --write-tree
HEAD origin/main` (clean; branch was 3 commits behind, which is not a conflict).
  Did NOT merge main in, to avoid unnecessary CI churn.
- **CI:** the prior BuildKite build (5209) was `canceled` — its pipeline-upload
  step never expanded child steps, so there was zero real CI signal. A fresh push
  was needed to get a real build.
- **Review comments:** 4 Greptile inline comments (3×P1, 1×P2).

## Review comments — resolution

1. **P1 leetcode `build-db.ts` malformed company JSON** — `JSON.parse(q.companyTagStatsV2)`
   could throw before `CompanyStatsSchema.safeParse` rejected it; the throw hit the
   per-problem `catch` and dropped the entire problem. Wrapped the parse in
   try/catch so malformed company JSON drops only company data (early return),
   keeping the problem. Boundary-input parsing → catch is appropriate here.
   Fixed in `cca1a7ef6`.
2. **P2 compliance-check.sh no-op variants** — the stub-ban regex only matched
   exact `true` / `echo ...`. Hardened to also match `:`, bare `echo`, and
   whitespace-padded stub variants (e.g. a `true` with leading/trailing spaces).
   Verified it does not false-positive on real scripts (`echotest`,
   `true-thing`). Fixed in `cca1a7ef6`.
3. **P1 tasknotes `vault/watcher.ts` stale state** — MOOT. The comment targets a
   file deleted by the origin/main merge (P3 rebuild #1391 replaced the whole
   `vault/` layer). The replacement `src/engine/watcher.ts` already fixes exactly
   this: on an FSWatcher error it closes the dead watcher, sets `needsFullRescan`,
   flushes, and re-arms with backoff (lines 90-98). No code change; replied on thread.
4. **P1 compliance-check.sh nested-package bypass** — the gate only scanned
   top-level `packages/*/`, so nested workspace packages could hide a no-op stub.
   Per Jerred's decision (close now, exempt not rewrite), extended the scan to the
   true workspace set. Fixed in `37656409a`.

## Nested-package scan (37656409a) — design

- Enumerate top-level `packages/*` plus the nested members each declares via its
  `workspaces` field (13 nested members: scout/dpp/mk64 sub-packages). This is the
  set root automation + CI actually run scripts for.
- Enumeration runs via **`bun`** (guaranteed in the CI Bun base image), reading each
  package's `workspaces` globs one level via `Bun.Glob` + `node:fs`. This removes
  the git/python dependency; the original leaned on `git check-ignore`, which the
  quality container doesn't reliably have. No gitignored top-level package dirs
  exist, so dropping that guard is safe.
- Standalone example/demo dirs (`astro-opengraph-images/examples/*`,
  `webring/example`) are NOT workspace members and are correctly excluded.
- Exemptions re-keyed to the package's repo-relative path so same-named nested
  siblings (dpp vs mk64 `common`) don't collide.
- `is_exempt` now also gates the no-op-stub failure, so a documented stub is
  allowed in place without deletion — this is how the 5 nested stubs
  (dpp/mk64 `common`, dpp `frontend`, scout `desktop`/`frontend`) are handled.
- Nested members that legitimately lack build/test (scout `data`/`ui`/`app`) are
  exempted too.
- `lefthook.yml` compliance-check glob extended to `packages/*/packages/*/package.json`.

### Verification

- `bash scripts/compliance-check.sh` → All packages compliant (exit 0)
- `shellcheck scripts/compliance-check.sh` clean
- Bypass test: removing any one exemption makes the corresponding nested stub FAIL
  — proves the gate really covers nested packages
- Example dirs confirmed excluded from the scan set
- `cd scripts/ci && bun test` → 313/313 pass (parity + hygiene goldens green)

## Session Log — 2026-07-10

### Done

- `cca1a7ef6` — leetcode malformed-JSON guard (P1) + compliance no-op regex hardening (P2)
- `37656409a` — compliance-check.sh scans nested workspace packages, 5 stubs exempted
  (not rewritten), bun-based enumeration, lefthook glob extended (P1 nested bypass)
- Replied on all 4 Greptile threads (2 fixes, 1 moot, 1 nested-package fix)
- Verified merge is clean vs origin/main via merge-tree

### Remaining

- CI build 5223 (on `37656409a`) to finish green. Currently monitoring; prior
  build 5209 was canceled with no signal, so this is the first real CI run.
- Once green with no new P3+ comments and no conflicts: report done and stop.

### Caveats

- BuildKite dynamic pipelines sit in `scheduled` for a bit before expanding child
  steps — do not mistake startup for "stuck." Judge CI via the GitHub commit-status
  aggregate + BuildKite job states, not the `mergeable`/cached view.
- The nested-package change is a granularity expansion of the compliance gate that
  the PR author had intentionally scoped to top-level only; done at Jerred's explicit
  direction. If any nested package later adds a real test/build, remove its exemption.
