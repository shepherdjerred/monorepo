---
id: plan-tracker-tracker-2026-08-08
type: plan
status: awaiting-human
board: true
verification: agent
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

- [ ] Confirm the ArgoCD application syncs and `https://tracker-tracker` loads
      through Tailscale.
- [ ] Populate the untracked `.env.tracker-tracker` with 1Password references,
      run the bootstrap, and confirm qBittorrent plus all three tracker tests.
- [ ] Confirm exported torrent state matches qBittorrent and no real cookies or
      passwords appear in Git, manifests, or command output.
