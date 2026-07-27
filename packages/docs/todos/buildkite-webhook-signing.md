---
id: buildkite-webhook-signing
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/archive/completed/2026-06-06_homelab-security-hardening.md
source_marker: false
---

# Require authenticated Buildkite webhook delivery

The remaining security-hardening question is whether the repository's Buildkite
trigger should use the Buildkite GitHub App or an explicitly signed webhook,
with configuration represented in IaC where the provider supports it.

## Remaining

- [ ] Inventory the live GitHub/Buildkite integration and document which party validates each inbound trigger.
- [ ] Select GitHub App delivery or signed webhooks; reject any design that stores secrets in repository files.
- [ ] Represent supported settings in the Buildkite/GitHub OpenTofu stacks and document any unavoidable console-only step.
- [ ] Add repository tests for the selected authentication contract. Credential
      rotation and live delivery tests are tracked in
      `buildkite-webhook-signing-rollout`.

## Comment Log

- 2026-07-27 — Split from the mostly completed homelab security plan. Tailnet
  ACLs shipped and alert-remediation was removed; only this privileged external
  integration action remains, so verification is operator-owned.
