---
id: log-2026-05-31-pr-996-ci-prettier-fix
type: log
status: complete
board: false
---

# PR #996 Prettier CI Fix

## Context

PR #996 failed Buildkite build #3101 on the `:art: Prettier` job:

- Command: `bash .buildkite/scripts/prettier.sh`
- Failed file: `packages/docs/logs/2026-05-30_pagerduty-velero-duplicate-alerts.md`

The homelab package validation jobs passed on the same Buildkite build, including
lint, typecheck, test, helm-types build, cdk8s synth, and `CI Complete`.

## Session Log - 2026-05-31

### Done

- Fetched PR branch `claude/great-fermi-396140` locally.
- Ran Prettier on
  `packages/docs/logs/2026-05-30_pagerduty-velero-duplicate-alerts.md`.
- Added this session log.

### Remaining

- Push the formatting commit and verify the new Buildkite build for PR #996 is
  green.

### Caveats

- Local `gh` auth is invalid, so PR metadata came from the GitHub connector and
  CI details came from the Buildkite CLI.
