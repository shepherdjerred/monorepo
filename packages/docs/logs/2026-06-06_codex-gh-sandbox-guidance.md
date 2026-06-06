# Codex GitHub CLI Sandbox Guidance

## Status

Complete

## Summary

Documented how Codex agents should handle `gh` inside the sandbox so network
blocking is not mistaken for a broken GitHub CLI.

## Session Log — 2026-06-06

### Done

- Added a root `AGENTS.md` section explaining that `gh` works in Codex but GitHub
  network access may require sandbox escalation.
- Documented how to separate sandbox/network failures from `gh auth status`
  failures.
- Documented write-action expectations for explicit targets and payloads.
- Preserved the monorepo rule that Buildkite, not GitHub Actions, is the CI source
  of truth.
- Opened draft PR <https://github.com/shepherdjerred/monorepo/pull/1031>.

### Remaining

- None.

### Caveats

- This is a documentation/instruction change only; no GitHub command behavior was
  changed.
