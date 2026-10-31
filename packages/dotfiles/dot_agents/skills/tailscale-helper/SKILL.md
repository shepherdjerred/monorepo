---
name: tailscale-helper
description: Current Tailscale guidance for the CLI, MagicDNS, Serve and Funnel, Taildrop, Tailscale SSH, ACLs and grants, exit nodes, subnet routers, containers, and Kubernetes. Use when operating a tailnet, reaching a dev server or sending files between machines, exposing a service, or debugging connectivity.
---

# Tailscale

Tailscale is a WireGuard mesh VPN. Each device gets a stable `100.64.0.0/10`
address and a MagicDNS name (`<machine>.<tailnet>.ts.net`); traffic flows
directly between peers when NAT traversal succeeds and over a relay otherwise.

## Current baseline

Verified against Tailscale 1.104.2 on 2026-10-31:

```bash
tailscale version
tailscale <command> --help   # authoritative for flags; this skill can lag
```

Flags and product availability change quickly. Check `--help` and the linked
official documentation before relying on a flag from this skill.

## Working rules

- Probe live state first with a read-only command (`tailscale status`,
  `tailscale serve status`, `tailscale funnel status`). Re-read it afterwards;
  do not claim success from a command exiting 0.
- Serve and Funnel are exposure changes. Funnel publishes to the internet and
  needs explicit confirmation. Never Funnel a dev server.
- A workstation's Serve configuration can hold unrelated listeners. Remove only
  the listener you added (`tailscale serve --https=<port> off`); never run
  `serve reset` or `funnel reset` unless asked.
- Use the MagicDNS label from `tailscale status`, not the OS hostname, and read
  the tailnet suffix from live output instead of assuming it.
- ACLs, grants, and SSH rules cannot be read from the CLI. Reachability that
  depends on policy is unverified until checked in the admin console or API.
- Do not install or invoke an MCP server for Tailscale.

## Most-used commands

```bash
tailscale status [--json]                 # peers, online state, health
tailscale ping --verbose <host>           # direct vs DERP; works when OS ping is firewalled
tailscale serve --bg <port>               # tailnet-only HTTPS proxy to 127.0.0.1:<port>
tailscale serve status
tailscale file cp <file> <host>:          # Taildrop send (trailing colon)
tailscale file get <dir>                  # Taildrop receive (Linux; GUI apps use Downloads)
tailscale ssh user@host
tailscale nc <host> <port>                # test a port over the tailnet
```

## Route by problem

Read only the reference the task needs.

- [Common tasks](references/common-tasks.md): reach a dev server from another
  machine, send files, rsync/scp, an exposure checklist, and a "can't reach
  host" sequence.
- [CLI reference](references/cli-reference.md): every subcommand with flags and
  workflows.
- [Networking](references/networking.md): MagicDNS, subnet routers, exit nodes,
  DERP and peer relays, containers, Kubernetes, Services, app connectors.
- [ACLs and security](references/acls-security.md): policy syntax, grants,
  tags, SSH rules, auth keys, API, Tailnet Lock.
- [Public product reference](references/public-product-reference.md): product
  map and the stable operating pattern.
- [Releases](references/releases.md): dated feature ledger; a snapshot, not an
  authority.

Canonical documentation: <https://tailscale.com/docs/>.
