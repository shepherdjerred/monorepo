---
app: Tailscale
icon: network
color: "#2D5BE4"
website: https://tailscale.com
category: New Features
---

- The tailscale wait command (added in v1.96) pauses execution until Tailscale resources become available for binding, making it easy to script startup sequences that depend on the tailnet being ready
- Use it in container entrypoints or init scripts to avoid race conditions where your application tries to bind a Tailscale address before the daemon has fully connected
- tailscale dns query and tailscale dns status now support a --json flag to return structured JSON output, useful for parsing DNS state in scripts and monitoring tools
