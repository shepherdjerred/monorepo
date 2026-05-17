# AGENTS.md CI Follow-up

## Status

Complete

## Context

Buildkite build #2478 for PR #822 failed after the AGENTS.md migration. The
hard failures tied to the migration were Prettier formatting and Gitleaks
allowlist paths after canonical skill files moved from `dot_claude/skills` to
`dot_agents/skills`.

## Session Log — 2026-05-15

### Done

- Rebased PR #822 onto `origin/main`.
- Updated `.gitleaks.toml` allowlists from `dot_claude/skills` to
  `dot_agents/skills`.
- Updated `.prettierignore` so vendored agent skills and cache directories do
  not fail formatting checks.
- Refreshed Prettier formatting in the Temporal PR review prompt builders.
- Updated `scripts/setup.ts` to refresh `packages/sjer.red` after shared
  packages are built, so local `file:` dependencies include their `dist/`
  outputs.
- Updated `packages/sjer.red/src/bookmarks/bookmarks.ts` to preserve a trailing
  newline when it rewrites the generated bookmarks JSON.
- Verified locally with `bun run scripts/setup.ts`, `bun run typecheck`,
  `bun run test`, `packages/sjer.red` tests, Buildkite Prettier check,
  Gitleaks, Markdownlint, and suppression checks.

### Remaining

- None.

### Caveats

- Knip and Trivy still report repository-wide advisory findings locally; both
  are configured as soft-fail Buildkite scans.
- `scripts/setup.ts` can regenerate Helm chart types from current upstream chart
  metadata; that generated drift was not part of this CI fix.
