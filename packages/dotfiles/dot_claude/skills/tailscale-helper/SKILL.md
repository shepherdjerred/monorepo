---
name: tailscale-helper
description: |
  Tailscale VPN and networking - CLI operations, MagicDNS, ACLs, SSH, funnel, serve, and network administration
  When user mentions Tailscale, tailscale commands, VPN, MagicDNS, tailnet, or Tailscale networking
---

# Tailscale Helper Agent

## What's New (2025-2026)

**Tailscale Services (GA, Jan 2026)** - Decouple apps from hosting devices with stable TailVIPs and MagicDNS names. Define services via API or admin console with virtual IPs auto-accepted across platforms.

**Peer Relays (Beta, Oct 2025)** - Use tailnet nodes as high-throughput relay servers when direct connections fail. Throughput approaches direct connections; orders of magnitude faster than managed DERP relays. Two free peer relays on all plans. Requires v1.86+.

**Tailnet Lock (GA, Jun 2025)** - Verify that only trusted nodes join the tailnet via cryptographic signing. Shifts trust from Tailscale coordination server to your own signing nodes.

**Grants (GA, May 2025)** - Unified network and application-layer access controls replacing traditional ACLs. Combine network rules with app capabilities in a single policy.

**Visual Policy Editor (GA, Oct 2025)** - Graphical ACL management in the admin console.

**4via6 Subnet Routers (GA, Jan 2025)** - Handle overlapping IPv4 subnets by mapping them through IPv6.

**Fast User Switching (GA, Jan 2025)** - Switch between multiple Tailscale accounts on a single device.

**Node Key Sealing (GA, v1.90)** - Hardware-backed node key protection on Linux, Windows, and macOS using TPM.

**v1.94 Highlights:** Workload identity tokens auto-generated, Peer Relay performance improvements, container/K8s Operator updates.

**v1.92 Highlights:** State file encryption, TPM attestation defaults, K8s workload identity federation, Funnel/Serve PROXY protocol support, network flow logs auto-recording.

## Overview

Tailscale is a WireGuard-based mesh VPN that creates a secure overlay network (tailnet) connecting devices across any network topology. Every device gets a stable Tailscale IP from the CGNAT range (`100.64.0.0/10`) that persists regardless of physical location. Tailscale handles NAT traversal, key management, and peer discovery automatically through a coordination server, while all data flows directly between devices via encrypted WireGuard tunnels.

## CLI Quick Reference

```bash
# Authentication & Connection
tailscale up                          # Connect and authenticate
tailscale up --auth-key=<key>         # Connect with pre-auth key
tailscale down                        # Disconnect from tailnet
tailscale login                       # Authenticate without connecting
tailscale logout                      # Disconnect and expire session
tailscale switch <account>            # Switch Tailscale account
tailscale switch --list               # List available accounts

# Status & Info
tailscale status                      # Show connection status
tailscale status --json               # JSON output
tailscale ip                          # Show Tailscale IP
tailscale ip --4                      # IPv4 only
tailscale ip --6                      # IPv6 only
tailscale whois <ip>                  # Identify device/user by IP
tailscale version                     # Show version
tailscale netcheck                    # Network diagnostics

# Connectivity
tailscale ping <hostname>             # Ping over Tailscale
tailscale ping --icmp <hostname>      # ICMP ping
tailscale ssh user@host               # SSH via Tailscale

# Configuration
tailscale set --hostname=<name>       # Set device hostname
tailscale set --ssh                   # Enable Tailscale SSH
tailscale set --advertise-exit-node   # Advertise as exit node
tailscale set --exit-node=<ip|name>   # Use exit node
tailscale set --advertise-routes=<cidr> # Advertise subnet routes
tailscale set --accept-routes         # Accept subnet routes
tailscale set --accept-dns            # Accept MagicDNS
tailscale set --shields-up            # Block incoming connections

# File Sharing (Taildrop)
tailscale file cp <file> <host>:      # Send file
tailscale file get <dir>              # Receive files

# Service Exposure
tailscale serve <port>                # Serve to tailnet (HTTPS)
tailscale serve --http=80 <port>      # Serve HTTP
tailscale serve status                # Show serve config
tailscale serve reset                 # Clear serve config
tailscale funnel <port>               # Expose to internet
tailscale funnel status               # Show funnel config

# Drive Sharing
tailscale drive share <name> <path>   # Share directory
tailscale drive unshare <name>        # Stop sharing
tailscale drive list                  # List shares

# Certificates
tailscale cert <domain>               # Generate TLS cert
tailscale cert --cert-file=<f> --key-file=<f> <domain>

# Exit Nodes
tailscale exit-node list              # List available exit nodes
tailscale exit-node suggest           # Suggest optimal node

# Tailnet Lock
tailscale lock init                   # Initialize Tailnet Lock
tailscale lock status                 # View lock status
tailscale lock sign nodekey:<key>     # Sign a node
tailscale lock add tlpub:<key>        # Add signing node
tailscale lock remove tlpub:<key>     # Remove signing node
tailscale lock disable <secret>       # Disable Tailnet Lock

# Diagnostics
tailscale bugreport                   # Generate bug report
tailscale bugreport --diagnose        # With diagnostics
tailscale dns status                  # DNS resolver status
tailscale metrics print               # Show client metrics

# Updates
tailscale update                      # Update client
tailscale update --dry-run            # Check for updates
```

## Key Features

### MagicDNS

Automatically registers DNS names for tailnet devices. Access machines by hostname (`ssh user@myserver`) instead of IP. Full domain: `<machine>.<tailnet-name>.ts.net`. Enabled by default for new tailnets.

### Tailscale SSH

Replace SSH key management with identity-based access. Run `tailscale set --ssh` on destination, configure SSH ACLs in policy file. Supports check mode requiring periodic re-authentication.

### Funnel

Expose local services to the public internet through encrypted relay. Limited to ports 443, 8443, and 10000. Traffic is end-to-end encrypted through Funnel relay servers.

### Serve

Share local services within the tailnet. Supports reverse proxy, file serving, static text, and TCP forwarding. Auto-provisions HTTPS certificates. Use `-bg` flag for persistence across reboots.

### Taildrop

Peer-to-peer encrypted file transfer between tailnet devices. Send with `tailscale file cp`, receive with `tailscale file get`.

### Exit Nodes

Route all internet traffic through a designated tailnet device. Use for travel security, geo-access, or compliance. Supports Mullvad exit nodes for commercial VPN integration.

### Subnet Routers

Extend tailnet to devices without Tailscale installed. Advertise routes with `tailscale set --advertise-routes=<cidr>`, approve in admin console or via autoApprovers.

### Peer Relays

Client-to-client relay fallback when direct connections fail. Higher throughput than DERP relays. Configure with `tailscale set --advertise-peer-relay`.

### Tailscale Services

Define stable virtual services with TailVIPs and MagicDNS names, independent of hosting devices. Supports high availability and granular access controls.

## Docker & Containers

```bash
# Pull official image
docker pull tailscale/tailscale:latest

# Run with auth key
docker run -d \
  -e TS_AUTHKEY=tskey-auth-... \
  -e TS_HOSTNAME=my-container \
  -e TS_STATE_DIR=/var/lib/tailscale \
  -v ts-state:/var/lib/tailscale \
  tailscale/tailscale:latest
```

Key environment variables: `TS_AUTHKEY`, `TS_HOSTNAME`, `TS_STATE_DIR`, `TS_ROUTES`, `TS_USERSPACE`, `TS_EXTRA_ARGS`, `TS_ACCEPT_DNS`, `TS_ENABLE_HEALTH_CHECK`, `TS_ENABLE_METRICS`.

Use sidecar pattern with `network_mode: service:tailscale` for other containers.

## ACL Policy Basics

```jsonc
{
  // Groups for role-based access
  "groups": {
    "group:engineering": ["user@example.com"],
  },
  // Tag ownership
  "tagOwners": {
    "tag:server": ["group:engineering"],
  },
  // Access rules (deny-by-default)
  "acls": [
    {
      "action": "accept",
      "src": ["group:engineering"],
      "dst": ["tag:server:*"],
    },
  ],
  // SSH access
  "ssh": [
    {
      "action": "accept",
      "src": ["group:engineering"],
      "dst": ["tag:server"],
      "users": ["root"],
    },
  ],
  // Auto-approve routes
  "autoApprovers": {
    "routes": { "10.0.0.0/8": ["tag:server"] },
    "exitNode": ["tag:server"],
  },
}
```

Use huJSON format (comments and trailing commas allowed). Grants are the recommended modern alternative to ACLs.

## Reference Files

- **`references/cli-reference.md`** - Complete CLI command reference with all subcommands, flags, and usage patterns
- **`references/networking.md`** - MagicDNS, subnet routers, exit nodes, DERP, NAT traversal, containers, Kubernetes
- **`references/acls-security.md`** - ACL policy syntax, grants, groups, tags, SSH ACLs, auth keys, API, Tailnet Lock

## Common Troubleshooting

| Issue                     | Command                                        |
| ------------------------- | ---------------------------------------------- |
| Check connection status   | `tailscale status`                             |
| Network diagnostics       | `tailscale netcheck`                           |
| Test peer connectivity    | `tailscale ping <host>`                        |
| DNS resolution issues     | `tailscale dns status`                         |
| Generate bug report       | `tailscale bugreport --diagnose`               |
| Check daemon logs (Linux) | `journalctl -u tailscaled`                     |
| Check daemon logs (macOS) | `log show --predicate 'process=="tailscaled"'` |
| Force reconnect           | `tailscale down && tailscale up`               |
| Verify routes             | `tailscale status --json \| jq '.Peer'`        |
