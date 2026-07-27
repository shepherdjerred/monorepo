---
id: codex-snapshot-secrets
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/plans/2026-07-27_agent-plain-tools.md
source_marker: false
---

# Codex shell snapshots persist plaintext secrets on disk

## Problem

Codex writes shell snapshots to `~/.codex/shell_snapshots/*.sh` that capture
the **full exported environment** of the login shell they were generated from.
On this machine that includes plaintext credentials:

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`
- `BUILDKITE_API_TOKEN`, `GRAFANA_API_KEY`, `BUGSINK_TOKEN`
- `ARGOCD_AUTH_TOKEN`, `HASS_TOKEN`, `PAGERDUTY_TOKEN`

Verified 2026-07-27: `head -50 ~/.codex/shell_snapshots/<file>.sh` shows
`export ANTHROPIC_API_KEY=sk-ant-...` etc. in cleartext. Snapshots accumulate
(one per session) and are never cleaned up, so every historical key lives on
disk indefinitely.

## Options

1. **`shell_environment_policy.exclude`** in `~/.codex/config.toml` — strip
   secret vars from the environment codex passes to shells. Open question:
   whether `exclude` affects what gets written into snapshots (the snapshot is
   generated from a login shell, not from the policy-filtered env), and
   whether excluding breaks agent tasks that legitimately need these tokens
   (Buildkite/Grafana/Bugsink MCP-less CLI access). Needs an experiment:
   add one var to `exclude`, start a session, check the new snapshot.
2. **Snapshot cleanup** — a launchd/cron job deleting
   `~/.codex/shell_snapshots/*.sh` older than N days. Treats the accumulation
   symptom, not the cleartext-at-rest issue, but trivially safe.
3. **Snapshot generation opt-out** — check whether codex has a config knob to
   disable shell snapshots entirely (would need docs/source dive; unknown at
   filing time).

Note: `~/.claude/shell-snapshots/` (Claude Code) was checked and only exports
`PATH` plus tool-shadowing functions — no secrets. This TODO is Codex-only.

## Remaining

- [ ] Experiment: does `shell_environment_policy.exclude` keep a var out of newly generated snapshots?
- [ ] Decide which secrets agents actually need in shells (Buildkite/Grafana/Bugsink tokens are used by skills; provider API keys likely are not — codex has its own auth)
- [ ] Apply chosen fix (exclude list and/or cleanup job) in `packages/dotfiles/`
- [ ] Rotate any long-lived tokens if the snapshot directory was ever synced/backed up off-machine
