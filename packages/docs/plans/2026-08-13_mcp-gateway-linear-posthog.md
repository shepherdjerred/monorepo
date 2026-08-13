---
id: plan-2026-08-13-mcp-gateway-linear-posthog
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Linear and PostHog through the MCP gateway

## Why

Linear and PostHog should be available to the same global AI clients without
duplicating vendor credentials across every client. The existing MCP gateway
already provides a tailnet-only, authenticated aggregation point and renders
downstream credentials from 1Password outside its ConfigMap.

## Decisions

- Keep the released, pinned `tbxark/mcp-proxy` image. Its current
  streamable-HTTP support is sufficient; downstream OAuth support from an
  unreleased revision is not required.
- Authenticate the Linear and PostHog upstreams with dedicated API keys held in
  the existing `mcp-gateway-credentials` 1Password item.
- Scope the PostHog personal API key to the intended project and request its
  CLI tool surface with `x-posthog-mcp-mode: cli`.
- Render both vendor keys in the init container alongside the existing remote
  MCP credentials. The source ConfigMap contains placeholders only.
- Expose the gateway's `/linear/sse` and `/posthog/sse` routes to Claude Code,
  Codex, Cursor, and OpenCode through Chezmoi-managed global configuration.
- Retain each client's existing approval and permission behavior. This change
  adds tool connectivity, not blanket approval to invoke mutating tools.

## Implementation

1. Add the two streamable-HTTP upstreams and their headers to the gateway
   configuration.
2. Add fail-closed secret rendering and Kubernetes Secret references for both
   keys, with synthesis coverage that proves secrets remain out of the
   ConfigMap.
3. Add the two authenticated gateway routes to each supported global client,
   preserving dynamic client state such as Claude's non-MCP preferences.
4. Add the vendor keys to 1Password and refresh the structural vault snapshot.
5. Update the gateway guide and the PostHog architecture explanation.

## Remaining

- [x] Add and test the Linear and PostHog gateway upstreams.
- [x] Configure Claude Code, Codex, Cursor, and OpenCode through Chezmoi.
- [x] Provision both vendor keys and refresh the 1Password snapshot.
- [x] Run focused repository verification and publish draft PR #2160.
- [ ] After merge, verify the deployed gateway lists tools for both upstreams.

## Verification

- Gateway synthesis tests assert both upstream definitions, required secret
  references, and placeholder-only ConfigMap content.
- Focused homelab tests, typecheck, lint, and staged-file pre-commit checks pass.
- Chezmoi renders valid client configuration without placing credentials in the
  repository source.
- Production acceptance remains distinct from source verification: after the
  PR merges and GitOps deploys it, connect through both gateway routes and list
  tools successfully.

## Comment Log

- 2026-08-13: Chose gateway-held API keys over unreleased downstream OAuth.
  Linear receives a write-capable key; PostHog receives a project-scoped
  personal API key using the MCP Server preset and CLI mode.
