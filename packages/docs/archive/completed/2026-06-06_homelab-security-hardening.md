---
id: plan-2026-06-06-homelab-security-hardening
type: plan
status: complete
board: false
---

# Homelab security hardening — GitHub, AI/LLM, tailnet

## Completion record

PR-1 (code) is implemented and verified in a worktree; tailnet ACLs and two console/secret steps remain. Detailed pen-test findings are tracked privately (this repo is public) — this doc records the remediation only.

## Context

A read-only, owner-authorized security assessment of the homelab (Kubernetes `torvalds`, ArgoCD, GitHub, Temporal) found that AI/LLM automation acted on untrusted input with broad credentials. This change implements the owner-approved subset of fixes. Accepted as-is by the owner (no change): birmel's broad tooling (trusted allowlist), the Temporal agent-task API's broad scope (it is authenticated with a constant-time bearer), and `:latest@sha256:…` images (digest-pinned).

## PR-1 — landed (code), verified

| Area                           | Change                                                                                                                                                                                                                         | Files                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| PR automation → owner-only     | Skip any PR whose author ≠ `shepherdjerred` (bots + non-owner folded into one `disallowedAuthorReason` helper). Stops external fork PRs from reaching the review/summary pipelines (whose verify stage executes PR-head code). | `packages/temporal/src/event-bridge/github-webhook.ts` (+ test)               |
| Verifier env hardening         | Verifier subprocess (`bun test`/`typecheck`/eslint on PR code) no longer inherits operational secrets — credential-named env vars are stripped by default.                                                                     | `packages/temporal/src/activities/pr-review/verify-runner.ts`                 |
| Reaction listener → owner-only | A 👎 only dismisses a review finding when the reactor is the owner (public repo: anyone could otherwise silence findings).                                                                                                     | `packages/temporal/src/lib/pr-review/reaction-listener-helpers.ts`            |
| mcp-gateway client auth        | Proxy now requires `Authorization: <token>` (`mcpProxy.options.authTokens`). Token injected from a Secret via a `render-config` busybox init container into an `emptyDir` — never stored in the ConfigMap.                     | `packages/homelab/src/cdk8s/src/resources/mcp-gateway/{config.json,index.ts}` |
| Delete dead code               | Removed unwired `code-review.sh` + `code-review-interactive.sh` (ran `--dangerously-skip-permissions` on untrusted comment text).                                                                                              | `.buildkite/scripts/`                                                         |

**Verification:** `temporal` + `homelab` typecheck clean; `temporal` eslint + prettier clean; `github-webhook.test.ts` 13/13 (incl. new untrusted-author case); `cdk8s` synth succeeds and `dist/mcp-gateway.k8s.yaml` shows only the placeholder in the ConfigMap with the real token as a `secretKeyRef` on the init container.

## Manual prerequisites before deploying PR-1

1. **1Password:** add field `MCP_PROXY_AUTH_TOKEN` (e.g. `openssl rand -hex 32`) to item `iixelnobjabehkgxhl3ekacdy4` (vault `v64ocnykdqju4ui6j6pua56xw4`). Without it the gateway init container fails closed (intended).
2. **Clients (out-of-repo):** add `"headers": { "Authorization": "<token>" }` to the `mcp-gateway-*` server entries in the live Claude/Cursor MCP config (not committed here). Update in lockstep with the deploy or clients 401.

## Closure

The MCP gateway work shipped. Tailnet ACLs shipped via PR #1045 and now live in
`packages/homelab/src/tofu/tailscale/`. Alert remediation was removed in PR #1365.
The only unresolved concern is split into
`packages/docs/todos/buildkite-webhook-signing.md`.

## Comment Log

- 2026-07-27 — Board audit reconciled all three former remaining items against
  current source/history. Closed this mixed plan and retained only the narrow
  Buildkite webhook decision/action as active operator work.
