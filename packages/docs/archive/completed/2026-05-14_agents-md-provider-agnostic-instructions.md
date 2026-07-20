---
id: reference-completed-2026-05-14-agents-md-provider-agnostic-instructions
type: reference
status: complete
board: false
---

# Provider-Agnostic Agent Instructions With Symlinks

## Summary

Use `AGENTS.md` as the canonical instruction file everywhere, and keep Claude compatibility through symlinks. This lets Codex, Claude Code, and other agents share one instruction source without duplicated wrapper content.

## Key Changes

- Rename every tracked instruction source from `CLAUDE.md` to `AGENTS.md`.
- Recreate each old `CLAUDE.md` path as a symlink to sibling `AGENTS.md`.
- Update active docs and instruction text to say `AGENTS.md` / "agent instructions" instead of treating `CLAUDE.md` as canonical.
- Leave historical archived docs/logs alone unless an active tool or current index depends on the reference.

## Dotfiles And Skills

- Make `packages/dotfiles/AGENTS.md` the canonical global instruction source for `~/AGENTS.md`.
- Keep `~/CLAUDE.md`, `~/.claude/CLAUDE.md`, and `~/.codex/AGENTS.md` as symlinks to the canonical global `AGENTS.md`.
- Move canonical user skills from `packages/dotfiles/dot_claude/skills/` to `packages/dotfiles/dot_agents/skills/`.
- Make Claude's skill path a symlink: `~/.claude/skills -> ~/.agents/skills`.
- Keep Codex-specific system skills untouched.

## Tooling Updates

- Update PR review bootstrap/summary loaders to prefer `AGENTS.md` and fall back to `CLAUDE.md` for external repos.
- Keep internal field names like `claudeMdHierarchy` for this migration unless changing them is required by tests; update user-visible prompt/log copy to "agent instructions hierarchy."
- Update Buildkite review prompts to read `AGENTS.md`.
- Update suppression-check allowlists so active `AGENTS.md` instruction files are treated like the old `CLAUDE.md` docs.
- Update Codex config to keep `CLAUDE.md` as a fallback filename for external repos and raise `project_doc_max_bytes` to `65536`.

## Test Plan

- Verify tracked symlinks:
  - 19 `AGENTS.md` files exist.
  - 19 `CLAUDE.md` symlinks point to sibling `AGENTS.md`.
  - Dotfile symlinks resolve to the intended global `AGENTS.md`.
  - Claude skills path resolves to the canonical `.agents/skills` tree.
- Run checks:
  - `bun run markdownlint`
  - `bun test packages/temporal/src/activities/pr-review/bootstrap.test.ts packages/temporal/src/activities/pr-review/specialists/correctness.test.ts`
  - `bun run --filter='./packages/temporal' typecheck`
  - `cd packages/temporal && bunx eslint . --fix`
  - If targeted checks pass, run `bun run typecheck` and `bun run test`.

## Assumptions

- Symlinks are acceptable for this repo even though Windows checkouts require Developer Mode or symlink privileges.
- `AGENTS.md` is the only canonical instruction content.
- `CLAUDE.md` exists only as compatibility for Claude Code.
- `.agents/skills` is the canonical user skill location; `.claude/skills` is compatibility.
- Existing unrelated worktree changes are not touched.

## Session Log — 2026-05-15

### Done

- Renamed tracked instruction sources to `AGENTS.md` and recreated `CLAUDE.md` compatibility symlinks.
- Moved canonical user skills to `packages/dotfiles/dot_agents/skills/` and made Claude's skill path point at `.agents/skills`.
- Updated dotfiles, Codex config, Buildkite prompts, suppression checks, Temporal PR-review loaders/prompts/tests, and active agent docs for `AGENTS.md` canonical use.
- Applied the live dotfiles targets for `~/AGENTS.md`, `~/.claude/CLAUDE.md`, `~/.claude/skills`, `~/.agents/skills`, `~/.codex/AGENTS.md`, and `~/.codex/config.toml`; manually set `~/CLAUDE.md -> AGENTS.md`.
- Verified with `bun run markdownlint`, targeted Temporal tests, `bun run --filter='./packages/temporal' typecheck`, `cd packages/temporal && bunx eslint . --fix`, `bun run typecheck`, and `bun run test`.

### Remaining

- None for the requested migration.

### Caveats

- `~/CLAUDE.md` is live as a symlink but is ignored by chezmoi because the repo also keeps `packages/dotfiles/CLAUDE.md` as a tracked compatibility symlink.
- Windows checkouts still require Developer Mode or symlink privilege for the compatibility links.
- The worktree already contains other unrelated edits; they were left in place.
