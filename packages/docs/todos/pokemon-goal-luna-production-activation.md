---
id: pokemon-goal-luna-production-activation
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/archive/completed/2026-07-26_pokemon-goal-luna-observability.md
---

# Activate and verify Luna goal mode in production

## Context

PR #1694 shipped the code. Production activation requires a privileged
1Password edit, workload restart, Discord command, and access to restricted
logs/traces.

## Remaining

- [ ] Update the Pokémon `config.toml` secret to `gpt-5.6-luna` with medium reasoning and restart the workload after the image is current.
- [ ] Run one authorized `/goal` session and verify structured `goal.tool` logs, spatial deltas, Luna pricing, and full tool bodies in tracing/archive output.

## Comment Log

### 2026-07-27 — extracted from implementation plan

- Reclassified as operator work; no subjective UAT remains in the completed code plan.
