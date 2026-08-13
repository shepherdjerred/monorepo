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

Never in the ConfigMap. `config.json` holds `*_PLACEHOLDER` markers; a busybox init container (`RENDER_CONFIG_SCRIPT`) seds the real tokens (`MCP_PROXY_AUTH_TOKEN`, `FASTMAIL_TOKEN`, `HOMEASSISTANT_TOKEN`, `LINEAR_API_KEY`, and `POSTHOG_API_KEY`) from the `mcp-gateway-credentials` 1Password item into `/rendered/config.json`. Fails closed if any is missing. The canvas and Gmail npx server _versions_ are substituted at synth time from `versions.ts` (datasource=npm, Renovate-tracked). GitHub's supported `github-mcp-server` binary is checksum-verified and baked into the custom gateway image.

Linear and PostHog follow the same boundary. `LINEAR_API_KEY` and
`POSTHOG_API_KEY` live in `mcp-gateway-credentials`, reach only the init
container through Kubernetes Secret references, and replace placeholders in
the rendered config. The Linear key is write-capable. The PostHog personal API
key is project-scoped and created with the MCP Server preset; `config.json`
also sends `x-posthog-mcp-mode: cli` to select PostHog's CLI-oriented tool set.

## Servers (post-#1155)

- canvas = npx (pinned).
- github = supported `github/github-mcp-server` binary in stdio mode, authenticated with `GITHUB_PERSONAL_ACCESS_TOKEN`.
- fastmail = official remote `https://api.fastmail.com/mcp` (streamable-http + Bearer, 19 tools).
- home-assistant = remote `/api/mcp` (streamable-http + Bearer long-lived token; 401 without it).
- linear = [official remote](https://linear.app/docs/mcp) at
  `https://mcp.linear.app/mcp` (streamable-http + Bearer API key).
- posthog = [official remote](https://posthog.com/docs/model-context-protocol/faq)
  at `https://mcp.posthog.com/mcp` (streamable-http + project-scoped personal
  API key, CLI mode).
- gmail = `@automatearmy/email-reader-mcp` (IMAP, non-fatal — hangs on init in-cluster despite valid creds+egress, needs a server swap).
- sonos = REMOVED (LAN multicast discovery impossible from a pod).

## Clients

Chezmoi configures two separate gateway routes globally:

- `https://mcp-gateway.tailnet-1a49.ts.net/linear/sse`
- `https://mcp-gateway.tailnet-1a49.ts.net/posthog/sse`

Claude Code, Cursor, and OpenCode use their native remote MCP support. Codex
uses pinned `mcp-remote@0.1.38` through `bunx` because its local adapter gives
the gateway's SSE routes and custom Authorization header one deterministic
configuration. Every client authenticates with the existing
`MCP_PROXY_AUTH_TOKEN`, rendered from 1Password by Chezmoi; no vendor key is
copied to a client. Cursor's default tool approval remains in force, and the
change does not add client-side auto-approval rules elsewhere.
