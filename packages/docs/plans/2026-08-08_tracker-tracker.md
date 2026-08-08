---
id: plan-tracker-tracker-2026-08-08
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Deploy Tracker Tracker for PrivateHD, AvistaZ, and AnimeZ

## Summary

Deploy Tracker Tracker to the Torvalds Kubernetes cluster through CDK8s and
ArgoCD with a dedicated namespace, Tailscale-only access, managed PostgreSQL,
qBittorrent integration, an automated 1Password-backed bootstrap, and a Bun
JSON/JSONL exporter.

## Scope

V1 provides tracker-level H&R/reseed counts plus qBittorrent torrent state and
history. It does not infer tracker-verified H&R status per individual torrent.

## Verification

- Synthesis tests cover deployment, database, PVCs, ingress, secrets, and
  cross-namespace network policy.
- Bootstrap and exporter tests cover setup, idempotency, TOTP, connection
  failures, output validation, and secret-safe logging.
- After deployment, verify Tailscale access, qBittorrent connectivity, all
  three tracker polls, profile values, and exporter output.

## Human Verification

A checklist item is accepted only when the stated live behavior is observed;
if any item fails, the plan remains `awaiting-human`.

- [ ] Confirm the deployed dashboard loads through Tailscale and is usable for
      the intended operator workflow.
- [ ] Confirm the displayed tracker profile values and exported torrent state
      match the live tracker and qBittorrent data.

Privileged deployment, 1Password setup, bootstrap, and secret-hygiene checks
are tracked separately in
`packages/docs/todos/tracker-tracker-deployment-activation.md`.
