---
id: log-2026-06-07-knip-ci-only-precommit
type: log
status: complete
board: false
---

# Make knip CI-only (off the pre-commit path)

## Context

Working across multiple `.claude/worktrees/` checkouts surfaced a recurring
cost: every fresh worktree needed a full `scripts/setup.ts` (install deps for
all ~30 packages) before you could even commit. Investigation traced the
"needs all 30 installed" requirement to a **single pre-commit hook: `knip`**.

The other pre-commit hooks (eslint, typecheck, test) are already per-package
and affected-scoped — each has `root: packages/X/` + `glob: packages/X/**`, so
touching one package only runs that package's jobs and only needs that
package's deps (plus a built `eslint-config`).

`knip`, by contrast, is a whole-graph dead-code analysis: `knip.json` is a
single root config declaring all ~27 workspaces, and the hook globbed on
`**/package.json` / `**/knip.json`, so staging any `package.json` ran knip
across the entire graph — requiring every package's deps to be resolvable.

This was weighed against (and chosen over) adopting Bun workspaces, which would
have collapsed the 30 per-package installs into one hoisted install but would
**not** have removed knip's whole-graph requirement, and would have reversed
the deliberate `file:` copy-on-install design (declaring `workspaces` makes Bun
symlink internal `file:` deps — verified empirically this session). Moving knip
off the commit path removes the pain entirely with zero dependency-structure
change.

## Change

`lefthook.yml` — removed the `knip` job from the `pre-commit` tier-2 group,
replaced with a comment documenting that it is CI-only. knip already runs in CI
via the `knip-check` Dagger step (`scripts/ci/src/steps/quality.ts:85`,
`.dagger/src/quality.ts:123`), so full-graph coverage is unchanged.

## Verification

- `lefthook validate` → "All good"
- YAML parses (js-yaml)
- `grep "name: knip" lefthook.yml` → no match (removed from pre-commit)
- Confirmed `knip-check` remains in the Buildkite pipeline generator and Dagger
  quality module → coverage preserved in CI.

## Session Log — 2026-06-07

### Done

- Removed `knip` from `pre-commit` in `lefthook.yml`; it now runs CI-only via
  the existing `knip-check` Dagger step. Added an explanatory comment in place.
- Verified CI coverage is preserved (`scripts/ci/src/steps/quality.ts`,
  `.dagger/src/quality.ts`, `scripts/ci/src/pipeline-builder.ts`).
- Validated config (`lefthook validate` → All good; YAML parses).
- Updated stale memory `reference_worktree_precommit_knip.md` (+ MEMORY.md
  index) to reflect knip is CI-only and fresh worktrees no longer need a full
  install to commit.

### Remaining

- Not committed yet — change is staged only in the worktree working tree.
  Commit/push when ready (worktree: `angry-almeida-c0c0ae`).
- Optional follow-ups discussed but not done: `compliance-check`,
  `quality-ratchet`, and `full-typecheck` are also whole-repo-ish but fire on
  narrow globs and don't pull package deps the way knip did — left in
  pre-commit. Revisit only if they prove to be a worktree-install cost too.

### Caveats

- The eslint pre-commit hooks still require the touched package's deps **and a
  built `eslint-config`** (see `reference_worktree_precommit_eslint`), so a
  fresh worktree still needs _some_ install — just not the whole-graph install
  knip forced. This change removes the all-30 requirement, not all installs.
- knip now only fails the build in CI, not locally pre-commit — dead-code
  regressions surface one step later (at PR CI) than before. Intentional
  trade-off for the worktree ergonomics.
