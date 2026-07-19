---
id: guide-2026-06-28-mcp-gateway-architecture
type: guide
status: complete
board: false
---

# mcp-gateway Architecture

## What it is

`packages/homelab/src/cdk8s/src/resources/mcp-gateway/` deploys `ghcr.io/tbxark/mcp-proxy`, which aggregates downstream MCP servers (defined in `config.json`) and exposes them at `:9090` (Tailscale ingress `mcp-gateway.tailnet-1a49.ts.net`, per-server paths like `/github/sse`). Clients send `Authorization: <MCP_PROXY_AUTH_TOKEN>`.

## Green ≠ working (gotcha)

Readiness + liveness are bare `tcpSocket: 9090`. The proxy binds `:9090` immediately at startup, independent of downstream servers, so the pod is `1/1` even if every downstream server is dead. To check real health, read pod logs for per-server `<name> Successfully listed N tools` / `Connected` vs servers stuck at `Connecting`. `mcpProxy.options.panicIfInvalid: true` makes a must-work server's init failure crashloop loudly (gmail overrides to `false`).

## Secrets

Never in the ConfigMap. `config.json` holds `*_PLACEHOLDER` markers; a busybox init container (`RENDER_CONFIG_SCRIPT`) seds the real tokens (`MCP_PROXY_AUTH_TOKEN`, `FASTMAIL_TOKEN`, `HOMEASSISTANT_TOKEN`) from the `mcp-gateway-credentials` 1Password item into `/rendered/config.json`. Fails closed if any is missing. npx server _versions_ (canvas/github/gmail) are substituted at synth time from `versions.ts` (datasource=npm, Renovate-tracked).

## Servers (post-#1155)

- canvas/github = npx (pinned).
- fastmail = official remote `https://api.fastmail.com/mcp` (streamable-http + Bearer, 19 tools).
- home-assistant = remote `/api/mcp` (streamable-http + Bearer long-lived token; 401 without it).
- gmail = `@automatearmy/email-reader-mcp` (IMAP, non-fatal — hangs on init in-cluster despite valid creds+egress, needs a server swap).
- sonos = REMOVED (LAN multicast discovery impossible from a pod).
