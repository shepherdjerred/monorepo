---
id: plan-2026-06-06-homelab-security-hardening
type: plan
status: planned
board: true
verification: agent
disposition: active
---

# Homelab security hardening — GitHub, AI/LLM, tailnet

## Status: Partially Complete

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

## Remaining

- [ ] **Tailnet ACLs (OpenTofu)** — new `packages/homelab/src/tofu/tailscale/` module, phased: (A) import current allow-all as `tailscale_acl` (zero-diff, IaC + drift detection), (B) add `tagOwners`/tags + ACL `tests`, (C) least-privilege grants restricting sensitive surfaces (argocd, temporal, seaweedfs, grafana, mcp-gateway, k8s API, Talos) to admin devices. Guardrail: never strip the CI/operator/admin path to the k8s API or `seaweedfs-s3.tailnet` (tofu state). Separate PR(s).
- [ ] **Buildkite webhook secret** — console/IaC step (prefer the Buildkite GitHub App / signed webhooks). Not a code change here.
- [ ] **alert-remediation (flagged, owner decision)** — `packages/temporal/src/activities/alert-remediation-command.ts` runs `Bash`+`Write`+push fed raw Bugsink/PagerDuty text hourly. Not addressed pending scope confirmation.

## Session Log — 2026-06-06

### Done

- Implemented + verified PR-1 (5 changes above) in worktree `flamboyant-matsumoto-184db1`.
- Confirmed dead scripts are 100% unreferenced in-repo before deletion.
- Reverted incidental `setup.ts` codegen churn (`generated/helm/promtail.types.ts`, `helm/index.ts`, `sjer.red/bun.lock`) so the diff is exactly the 8 intended paths.

### Remaining

- Tailnet ACLs (phased), Buildkite webhook secret, the two manual prerequisites above, and the alert-remediation scope decision.
- Commit + open PR (not yet done — awaiting owner go-ahead).

### Caveats

- Running `bun run scripts/setup.ts` locally regenerates committed helm types and **drops `promtail.types.ts`** (promtail isn't in the codegen catalog) — a pre-existing codegen/catalog drift unrelated to this work; restore those files if setup churns them.
- mcp-gateway change is deploy-coordinated: do the 1Password field + client header updates with the rollout.
- Detailed pen-test findings (attack chains) intentionally kept out of this public repo.
