# Stop committing resume.pdf — build it in CI, ship as a Buildkite artifact

## Status

Complete

## Context

`packages/resume/resume.pdf` was a committed build artifact: the "deploy sites"
lane synced the checked-out PDF straight to the bucket (`buildCmd: "true"`,
"pre-built"), while the `resume-build` CI step compiled the LaTeX in a texlive
container and threw the result away. This session made the PDF a real build
artifact, mirroring the existing sjer.red pattern (e2e step builds dist →
`artifact_paths` → deploy step downloads → `deploy-site.ts --prebuilt`).

## Changes

- `packages/resume/resume.pdf` — untracked (`git rm --cached`); `*.pdf` added
  to `packages/resume/.gitignore`.
- `.buildkite/pipeline.yml`
  - `resume-build` step: added `artifact_paths: "packages/resume/resume.pdf"`.
    The PR affectedness skip stays; main always builds (deploy consumes the
    artifact).
  - `deploy sites` step: `depends_on` now includes `resume-build`; downloads
    the PDF artifact (`buildkite-agent artifact download … --step resume-build`)
    and deploys resume `--prebuilt`; resume removed from the generic loop.
- `scripts/deploy-site.ts` — resume `buildCmd` changed from `"true"` to
  `"bun run build"` so local `bun run deploy` builds the PDF first; CI skips it
  via `--prebuilt`.
- `packages/resume/turbo.json` — dropped the `"!resume.pdf"` input exclusion
  (gitignored files are already excluded from `$TURBO_DEFAULT$`); comment
  updated. `outputs: ["*.pdf"]` unchanged.
- `packages/resume/AGENTS.md`, `package.json` description — updated to the new
  flow.

## Verification

- `bunx turbo run build --filter='@shepherdjerred/resume'` from a clean tree
  (PDF deleted first) rebuilds `resume.pdf`; `git status` stays clean
  (gitignore works).
- `bun scripts/deploy-site.ts resume --dry-run` → "would run `bun run build`"
  then the sync plan.
- `bun scripts/deploy-site.ts resume --dry-run --prebuilt` → build skipped,
  sync plan printed.
- `bun run verify -- --affected` green (see Session Log).

## Failure-mode notes

- If the artifact download in "deploy sites" fails (no artifact), the step
  fails loudly before any sync — the bucket is never synced without a PDF.
  `resume-build` has no affectedness skip on main, so the artifact always
  exists there.
- `--prebuilt`'s empty-dir refusal is a weak guard for resume specifically
  (distDir is the whole `packages/resume/`, which is never empty); the loud
  artifact download is the real gate.

## Session Log — 2026-07-19

### Done

- All changes above on branch `feature/resume-pdf-artifact`
  (worktree `.claude/worktrees/resume-pdf-artifact`), PR opened.
- Also identified two stale stashes in the main checkout
  (`scanner-agent-shell-fix` — superseded by the pinned-scanner rewrite;
  `wip-docs` — a 3-byte nondeterministic PDF rebuild). Left for the user to
  drop.

### Remaining

- Merge the PR; after the first main build, confirm the "deploy sites" step
  downloads the artifact and https://resume.sjer.red still serves the PDF.

### Caveats

- Local `bun run deploy` (and `deploy-site.ts resume` without `--prebuilt`)
  now requires xelatex locally — previously it silently synced the committed,
  possibly stale PDF.
- The resume bucket sync still uploads the whole `packages/resume/` dir
  (tex source, package.json, AGENTS.md, …) — pre-existing behavior, unchanged
  here.
