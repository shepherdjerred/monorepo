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
| Talos node     | `torvalds.tailnet-1a49.ts.net`              |
| Kubernetes API | `https://torvalds.tailnet-1a49.ts.net:6443` |

Torvalds remains the sole control-plane endpoint. Liskov has a Tailscale FQDN
in its Talos certificate, but it cannot be used as its own Talos proxy
endpoint. The tailnet policy must allow the Torvalds proxy to reach Liskov on
TCP/50000 before it is added to the default Talos node list. The generated
cluster control-plane endpoint remains the LAN address because it is an
internal cluster identity; this does not affect external Tailscale management.
LAN access is retained only for bootstrap, rollback, and this internal cluster
identity.

## Implementation

- Add the missing Kubernetes API FQDN SAN on Torvalds and the missing Talos
  machine API FQDN SAN on Liskov.
- Regenerate and apply full Talos configurations from the existing secret
  bundle, preserving a protected rollback copy.
- Update the chezmoi Talos and Kubernetes templates and apply them locally
  only after canonical TLS validation succeeds. Do not add Liskov to the
  default Talos context until the required tailnet policy is in place.
- Replace normal-operation LAN commands in the homelab runbooks; retain a
  clearly labelled break-glass path.
