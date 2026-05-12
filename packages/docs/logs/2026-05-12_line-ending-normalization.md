# Line-ending normalization sweep

## Status

Complete

## Context

Follow-up to PR #782. While unbreaking main after renovate-481, hit a file (`packages/birmel/prisma/schema.prisma`) with mixed CRLF/LF line endings — Edit-tool re-emit changed all lines to LF and `git diff` showed the entire file as modified, masking the actual semantic change. Audited the rest of the repo and found 47 more Unix-only files with CRLF or mixed endings, plus a structural gap: nothing in lefthook or CI was checking line endings, so the next renovate sweep (or any IDE that defaults to CRLF) could re-introduce the problem silently.

## What changed

### `.gitattributes` (root, replacement)

Replaced the prior binary-only `.gitattributes` with a complete policy:

- Default `* text=auto eol=lf` — every text file normalizes to LF on commit, checks out as LF on Mac/Linux.
- Explicit `eol=crlf` for Windows-only file types (`.bat`, `.cmd`, `.ps1`, `.psm1`, `.sln`, `.vcxproj`, `.vcxproj.filters`, `.wapproj`, `.appxmanifest`, `.props`, `.targets`) and the entire `packages/clauderon/mobile/windows/**` tree + `NuGet.config`. These get CRLF on checkout regardless of platform so Visual Studio / .NET / Windows tooling sees the format it expects and won't churn the file on save.
- `-text` for `packages/webring/src/testdata/rss-*.xml` (RSS test fixtures captured from real-world feeds — preserve byte-for-byte).
- Existing binary-file declarations carried over and extended (woff/woff2/ttf/eot/otf/pdf/bin).
- `archive/** -text` and `practice/** -text` placed LAST so they override every preceding rule (gitattributes uses last-match-wins) — those trees stay frozen.

### Renormalized 65 tracked files via `git add --renormalize .`

Categorized:

- **47 Unix files** that were CRLF or mixed — now LF in the index and on disk:
  - 13 `.gitignore` / `.prettierignore` / `.dockerignore` files
  - 7 `.cursor/rules/*.mdc` in `packages/homelab`
  - 5 Rust source files in `packages/clauderon/src/` and `tests/`
  - 5 SVG files (XML, treated as text by default)
  - 3 TOML configs (bunfig.toml, NuGet.config caveat below)
  - 2 Python files
  - 2 templates (`.tmpl`)
  - `packages/birmel/prisma/schema.prisma` (the original culprit)
  - `packages/resume/resume.tex`, `packages/tips/.swiftformat`, `packages/sjer.red/public/fonts/CommitMono/license.txt`, `packages/homelab/src/cdk8s/config/.../GravesX/placeholder*.txt`
- **18 Windows files** — index re-stored as LF (git always stores LF for text), checkout converts to CRLF via `eol=crlf`. Visual Studio still sees CRLF.

### `scripts/check-line-endings.ts` (new)

Runs `git ls-files --eol` and flags any file whose **index** EOL state is `crlf` or `mixed` while its `.gitattributes` doesn't allow CRLF. Skips `-text`/`binary` files, symlinks, and empty files. Supports both full-repo (CI) and staged-files (lefthook) modes.

The renovate-481 mode of failure was: a CRLF/mixed blob landed in the index and nothing checked. This script catches exactly that.

### `lefthook.yml` (1-line addition)

Added a `line-endings` job to the `safety-checks` group (parallel with `gitleaks` / `env-var-names` / `large-files` / `merge-conflicts`):

```yaml
- name: line-endings
  run: bun scripts/check-line-endings.ts {staged_files}
```

### `scripts/ci/src/steps/quality.ts` + `pipeline-builder.ts`

Added `lineEndingsCheckStep()` and registered it in the `blockingGates` array alongside `envVarNamesStep()`. New Buildkite step `:scroll: Line Endings` runs `bun scripts/check-line-endings.ts` against the full repo. Plain step (no Dagger) — only needs `bun + git` which are in `ci-base`. Updated the `PLAIN_STEP_KEYS` allowlist in the pipeline-builder test.

## Verification

- `bun scripts/check-line-endings.ts` → "✓ 18563 files clean".
- Negative test: injected a CRLF blob into the index via `git update-index --add --cacheinfo` → check correctly flagged it with the right error message and exit 1.
- `cd scripts/ci && bun test` → 145 pass / 0 fail.
- `cd scripts/ci && bun run typecheck` → clean.
- Verified `git ls-files --eol` reports correct attributes:
  - `packages/birmel/prisma/schema.prisma`: `i/lf attr/text=auto eol=lf`
  - `packages/clauderon/mobile/windows/ClauderonMobile.sln`: `i/lf w/crlf attr/text eol=crlf` (blob LF, checkout CRLF — correct git behavior)
  - `packages/webring/src/testdata/rss-10.xml`: `i/mixed attr/-text` (preserved as-is, skipped by check)

## Caveats

- The first attempt at `.gitattributes` had `archive/** -text` BEFORE `*.sln eol=crlf`. Last-match-wins meant `*.sln` took precedence and `archive/shepherdjerred-impostor/**/*.sln` got renormalized too. Moved `archive/**` and `practice/**` to the end of the file.
- `git ls-files --eol -z` output exceeds Node's default 1 MiB spawnSync buffer for this repo (~1.5 MB). Bumped `maxBuffer` to 64 MiB in the script.
- First parser regex required `w/<value>` (non-empty work-tree EOL) but git emits empty padded `w/` for files not checked out. Loosened to `w/(\S*)`.
- `packages/clauderon/mobile/src/types/generated/index.ts` is a symlink (mode 120000); script now skips entries where `i/` is empty.
- 65 files in the renormalize commit are mostly content-identical (just line-ending changes). Reviewers should `git diff --ignore-all-space` for a meaningful diff or use the GitHub PR view's "Hide whitespace" toggle.

## Session Log — 2026-05-12

### Done

- Audited repo: 1039 CR-containing files total, 67 in-scope (outside `archive/` + `practice/`), categorized as 19 legitimate Windows / 1 test fixture / 47 should-be-LF.
- Wrote root `.gitattributes` policy + ran `git add --renormalize .` (65 files).
- Added `scripts/check-line-endings.ts` (uses `git ls-files --eol`).
- Wired into `lefthook.yml` `safety-checks` group + `scripts/ci` blocking gates.
- Verified positive (18563 clean) + negative (injected CRLF blob caught) cases.
- Tests: 145/145 pass; typecheck clean.

### Caveats

- See above. Notable: this PR will be **noisy** — 65 files in the diff with mostly invisible changes. Reviewers should diff with whitespace ignored.

### Remaining

- Push branch and open PR; monitor that the new `line-endings-check` step runs on the PR and passes.
- Independent of PR #782 — can land in either order.
