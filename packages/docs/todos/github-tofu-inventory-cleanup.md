---
id: github-tofu-inventory-cleanup
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-04-05_opentofu-audit-expansion.md
---

# Reconcile the GitHub OpenTofu repository inventory

## Context

The broad OpenTofu audit is closed. Current source still has an unused
`cloudflare_account_id` variable, while repository coverage should be compared
against the live non-archived GitHub inventory before changing resources.

## Remaining

- [ ] Compare `packages/homelab/src/tofu/github/` with the current non-archived repository inventory and add/import only confirmed missing repositories.
- [ ] Remove the unused `cloudflare_account_id` input and prove a zero-surprise OpenTofu plan.

## Comment Log

### 2026-07-27 — extracted from umbrella plan

- Split from the completed 2026-04-05 OpenTofu audit because this is a current, bounded agent task.
