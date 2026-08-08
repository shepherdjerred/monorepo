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

- [ ] Confirm the ArgoCD application syncs and `https://tracker-tracker` loads
      through Tailscale.
- [ ] Populate the untracked `.env.tracker-tracker` with 1Password references
      and observe a successful bootstrap connection to qBittorrent and all three
      trackers.
- [ ] Confirm the displayed tracker profile values and exported torrent state
      match the live tracker and qBittorrent data.
- [ ] Confirm no real cookies or passwords appear in Git, manifests, or command
      output.
