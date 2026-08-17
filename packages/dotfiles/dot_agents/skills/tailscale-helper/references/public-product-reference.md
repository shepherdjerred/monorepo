# Tailscale product reference

Adapted from the Alpha `tailscale/tailscale-skill` product index. Product syntax
and availability change quickly; use the linked official documentation and
verify local command help before operating a live tailnet.

## Product map

- Core networking: tailnets, WireGuard peers, MagicDNS, exit nodes, subnet
  routers, site-to-site links, DERP/peer relays, and grants.
- Access and identity: Tailscale SSH, device posture, tags, auth keys, Tailnet
  Lock, SCIM/MDM, and session recording.
- Service access: Serve for tailnet-only publishing and Funnel for public
  exposure. Treat both as security-sensitive changes and inspect status after
  every operation.
- Workloads: Docker, the Kubernetes operator, workload identity, CI runners,
  `tsnet`, and application connectors.
- Sharing and operations: Taildrop, Taildrive, certificates, API automation,
  and diagnostic reports.

## Stable operating pattern

1. Identify the tailnet, device, service, and intended audience.
2. Read current product documentation for flags and policy syntax.
3. Probe authentication and live state with a read-only command.
4. Make the smallest requested change, with explicit confirmation for exposure,
   routing, ACL/grant, or device membership changes.
5. Re-read status, connectivity, and policy state; do not claim success from a
   configuration file alone.

Canonical documentation: <https://tailscale.com/docs/>.
