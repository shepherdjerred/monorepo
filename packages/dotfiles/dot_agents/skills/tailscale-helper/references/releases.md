# Tailscale release ledger

A dated snapshot of notable features, moved out of the skill entrypoint so it
does not read as current truth. Confirm availability and minimum versions in the
official docs and with `tailscale <command> --help` before depending on any item.

| Feature | Stage when recorded | Notes |
| --- | --- | --- |
| Tailscale Services | GA, Jan 2026 | Stable TailVIPs and MagicDNS names independent of hosting devices; `tailscale service list` shows those reachable from a node. |
| Peer Relays | Beta, Oct 2025 | Tailnet nodes relay for peers when direct paths fail. Enable with `tailscale set --relay-server-port=<udp-port>`; `--relay-server-static-endpoints` advertises fixed endpoints. Requires v1.86+. |
| Tailnet Lock | GA, Jun 2025 | Nodes must be signed by trusted signing nodes before joining. |
| Grants | GA, May 2025 | Network and application-layer access in one policy; the modern alternative to ACLs. |
| Visual policy editor | GA, Oct 2025 | Graphical policy management in the admin console. |
| 4via6 subnet routers | GA, Jan 2025 | Maps overlapping IPv4 subnets through IPv6. |
| Fast user switching | GA, Jan 2025 | `tailscale switch` between accounts on one device. |
| Node key sealing | GA, v1.90 | TPM-backed node keys on Linux, Windows, and macOS. |
| v1.92 | | State file encryption, TPM attestation defaults, Kubernetes workload identity federation, PROXY protocol for Serve and Funnel, flow logs auto-recording. |
| v1.94 | | Workload identity tokens, Peer Relay performance work, container and Kubernetes operator updates. |
