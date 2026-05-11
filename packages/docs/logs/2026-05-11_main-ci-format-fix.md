# Main CI Format Fix

## Status

Complete

## Summary

Buildkite `main` build 2271 failed hard on Prettier and Markdownlint because
`packages/docs/index.md` was missing a blank line before the list under
`## Logs`.

Knip and Trivy also reported failures in the Buildkite job list, but those jobs
are soft-fail signal checks and were not the hard CI blockers for this fix.

## Session Log - 2026-05-11

### Done

- Ran `bunx prettier --write packages/docs/index.md` to add the missing blank
  line before the Logs list.
- Verified `bunx prettier --check packages/docs/index.md`.
- Verified `bun run markdownlint packages/docs/index.md`.

### Remaining

- Commit and push the fix to trigger a new Buildkite build on `main`.

### Caveats

- Knip and Trivy remained soft-fail signal jobs in Buildkite build 2271; they
  were not changed in this session.
