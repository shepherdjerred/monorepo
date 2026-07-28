---
id: 2026-07-27-tailscale-management-endpoints
type: plan
status: in-progress
board: false
---

# Tailscale management endpoints

Make Tailscale FQDNs the normal management paths for the Talos cluster:

| Surface        | Canonical endpoint                          |
| -------------- | ------------------------------------------- |
| Talos endpoint | `torvalds.tailnet-1a49.ts.net`              |
| Talos nodes    | Torvalds and Liskov FQDNs                   |
| Kubernetes API | `https://torvalds.tailnet-1a49.ts.net:6443` |

Torvalds remains the sole control-plane endpoint. Liskov is a Talos target
only, never a Kubernetes API or Talos proxy endpoint. LAN access is retained
only for bootstrap and rollback.

## Implementation

- Add the missing Kubernetes API FQDN SAN on Torvalds and the missing Talos
  machine API FQDN SAN on Liskov.
- Regenerate and apply full Talos configurations from the existing secret
  bundle, preserving a protected rollback copy.
- Update the chezmoi Talos and Kubernetes templates and apply them locally
  only after canonical TLS validation succeeds.
- Replace normal-operation LAN commands in the homelab runbooks; retain a
  clearly labelled break-glass path.

## Session Log — 2026-07-27

### Done

- Created isolated worktree `feature/tailscale-management` from `origin/main`.
- Confirmed the current gaps: Liskov's Talos certificate lacks its Tailscale
  FQDN and the Kubernetes API certificate lacks Torvalds' Tailscale FQDN.

### Remaining

- Implement, validate, apply, and publish the management-endpoint migration.

### Caveats

- The live cluster has one control-plane node; apply the Torvalds change with
  rollback material available before changing managed clients.
