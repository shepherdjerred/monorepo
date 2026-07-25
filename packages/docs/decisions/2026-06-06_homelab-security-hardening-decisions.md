---
id: decision-2026-06-06-homelab-security-hardening-decisions
type: decision
status: complete
board: false
---

# Homelab security hardening — owner decisions (2026-06-06 pen test)

**Date:** 2026-06-06
**Status:** PR-1 landed; tailnet ACLs + Buildkite webhook secret pending

A read-only, owner-authorized pen test of the homelab (k8s `torvalds`, ArgoCD, GitHub, Temporal, AI/LLM workloads) produced these standing owner decisions. (Scope differs from the 2026-04-04 CI security audit, which covered Buildkite/Dagger fork-PR risk.)

## Decisions

- **PR automation must be scoped to `shepherdjerred` only** — closes external fork-PR code execution in the review pipeline's verify stage.
- **Temporal agent-task broad scope is ACCEPTED** because it's authenticated (constant-time bearer, fail-closed). Do **not** lock down its tools.
- **birmel's broad tooling is INTENTIONAL** (incl. `execute-shell-command`, repo editor) — gated by a trusted ~18-user Discord allowlist. Do **not** "fix".
- **`:latest@sha256:…` images are fine** (digest-pinned).
- **Wants tailnet ACLs** via OpenTofu (every device is currently fully trusted) — see `../guides/2026-06-06_tailscale-acls-runbook.md`.

## PR-1 (landed)

- PR webhook + reaction-listener gated to owner (`packages/temporal/src/event-bridge/github-webhook.ts`, `src/lib/pr-review/reaction-listener-helpers.ts`).
- Verifier subprocess env secret-scrubbed (`src/activities/pr-review/verify-runner.ts`).
- mcp-gateway client auth via `mcpProxy.options.authTokens` + a render-config init container (`packages/homelab/src/cdk8s/src/resources/mcp-gateway/`). Deploy needs two manual steps: add 1P field `MCP_PROXY_AUTH_TOKEN` to the mcp-gateway credentials item, and add the `Authorization` header to the live (out-of-repo) Claude/Cursor mcp-gateway client config.
- Deleted dead `.buildkite/scripts/code-review*.sh`.

## Remaining

- Tailnet ACLs (phased tofu module `packages/homelab/src/tofu/tailscale/`).
- Buildkite webhook secret (console / GitHub App).
- A decision on the hourly `alert-remediation` agent (runs Bash+Write+push on attacker-influenceable Bugsink/PagerDuty text).

Detailed exploit chains are kept OUT of the public repo (local only). Full plan + sanitized log: `../plans/2026-06-06_homelab-security-hardening.md`.
