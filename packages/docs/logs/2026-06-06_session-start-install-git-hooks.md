# SessionStart hook: install Lefthook git hooks on new worktrees/sessions

## Status

Complete

## Goal

Make Claude ensure the repo's Lefthook pre-commit / commit-msg hooks are wired up
at the start of every session — especially in freshly created worktrees and fresh
clones — so a commit can never slip through ungated.

## Findings

- Git hooks are managed by **Lefthook** (`lefthook.yml`). `lefthook install` (run by
  the root `package.json` `prepare` script during `bun install` / `scripts/setup.ts`)
  writes the hook scripts into the common `.git/hooks` dir and sets `core.hooksPath`.
- Empirically confirmed: a **freshly created worktree already inherits**
  `core.hooksPath = <main>/.git/hooks` from the shared config, and the `pre-commit` /
  `commit-msg` scripts exist there — so hooks normally fire in worktrees with no
  per-worktree step.
- The real gap a SessionStart hook closes: the first commit in a worktree/clone where
  `bun install`/`setup.ts` hasn't run yet, `core.hooksPath` is unset, or the hook
  scripts were wiped. The hook is a cheap, self-healing safety net.

## Change

- Added `.claude/hooks/install-git-hooks.sh` — modeled on the existing
  `trust-mise.sh` SessionStart hook. Best-effort, never blocks the session:
  - Resolves the working dir from stdin `.cwd` → `CLAUDE_PROJECT_DIR` → `PWD`.
  - Exits early (cheap) if not a git work tree or no `lefthook.yml`.
  - Resolves the effective hooks dir (`core.hooksPath` first, else `$GIT_DIR/hooks`).
    If `pre-commit` already exists there → prints "already installed" and exits.
    This check runs **before** looking for any lefthook runner, so an environment
    with no lefthook but with hooks already inherited never pays for resolution.
  - Otherwise resolves a lefthook runner — `lefthook` on PATH, else `bunx lefthook`,
    else `npx --yes lefthook` (the npm package ships prebuilt binaries) — runs
    `<runner> install` (idempotent), and reports success/failure. If none of the
    three are available, prints a clear, non-blocking message telling the dev to
    install lefthook or run `bun install`.
- Wired it into `.claude/settings.json` `SessionStart` array, after `trust-mise.sh`.

## Verification

- `jq` confirms `settings.json` is valid and both SessionStart commands are present.
- `shellcheck` clean; no banned standalone `2>/dev/null` / `|| true` (passes the
  repo's `check-suppressions` pre-commit job).
- Pipe-tested the hook:
  - Already-installed worktree (inherited `core.hooksPath`) → "already installed", exit 0.
  - Throwaway `git init` repo with `lefthook.yml`, no hooks → installs `pre-commit`
    via `lefthook`, exit 0; re-run is idempotent ("already installed").
  - Non-git dir, empty stdin, nonexistent cwd → all exit 0 silently.
- Lefthook-runner fallback: confirmed `bunx lefthook install` works end-to-end, and
  unit-tested the resolver picks `lefthook` → `bunx lefthook` → `npx --yes lefthook`
  → clear message across all availability combinations.

## Session Log — 2026-06-06

### Done

- Added `.claude/hooks/install-git-hooks.sh` (executable) and registered it as a
  second `SessionStart` hook in `.claude/settings.json`.
- Verified install / skip / idempotent / safe-early-exit behavior by pipe-testing.

### Remaining

- The hook only takes effect for sessions started _after_ it lands on the default
  branch (settings are read at session start). This current session won't show the
  status line until next launch / `/hooks` reload.

### Caveats

- `lefthook install` rewrites the **shared** `.git/hooks` scripts and may set
  `core.hooksPath` in the per-worktree `config.worktree` (observed under
  `extensions.worktreeConfig=true`). This is idempotent and harmless.
- This hook guarantees the hooks are _installed_; it does not guarantee they _pass_.
  In a fresh worktree, pre-commit jobs (eslint-homelab, knip) still fail until
  `scripts/setup.ts` installs all package deps — run setup before committing.
