---
id: log-2026-06-13-mcp-gateway-fastmail-official
type: log
status: complete
board: false
---

# mcp-gateway: official Fastmail MCP + downstream hardening — 2026-06-13

## Context

After populating the gateway's 1Password credentials (FASTMAIL_TOKEN, GMAIL_TOKEN), the pod recovered to `1/1`. But inspection showed the "green" was hollow: the readiness/liveness probes are **bare TCP on `:9090`**, and the proxy binds that port immediately at startup, independent of downstream servers. `panicIfInvalid` was unset (default false), so failed servers are silently skipped. Result: 3 of 6 downstream servers (`sonos`, `home-assistant`, `gmail`) were stuck in `Connecting` forever while the pod stayed green.

## Diagnosis (per server)

- **github / canvas / fastmail(old)** — connected fine (26 / 50 / 3 tools).
- **sonos** — `uvx`-built from git, relies on LAN multicast discovery → impossible from an in-cluster pod → hangs.
- **home-assistant** — bridge passed no auth; `/api/mcp` returns 401 without a token. Confirmed it's a streamable-http endpoint that returns 200 + `serverInfo home-assistant 1.26.0` with a Bearer long-lived token.
- **gmail** — IMAP egress from cluster verified (`imap.gmail.com:993` open) and the app password authenticates (12 mailboxes via `imaplib`), but `@automatearmy/email-reader-mcp` itself never completes MCP init. Server-side bug, not config.

## Changes (PR #1155)

- **fastmail** → official remote `https://api.fastmail.com/mcp`, native `streamable-http` client, Bearer-authed (verified: 19 tools). Replaces `@jahfer/jmap-mcp-server`.
- **home-assistant** → native `streamable-http` client + Bearer long-lived token (replaces the unauth'd `uvx` bridge).
- **sonos** → removed.
- **gmail** → pinned, `panicIfInvalid: false` (non-fatal), flagged for server swap.
- **reliability** → `mcpProxy.options.panicIfInvalid: true` (loud failures); npx server versions (canvas/github/gmail) pinned in `versions.ts`, Renovate-tracked via `datasource=npm` (extended `versions.test.ts` enums to allow npm).
- Tokens rendered into the config by the init container (3-token sed), never in the ConfigMap. New 1Password keys: `FASTMAIL_TOKEN`, `GMAIL_TOKEN`, `HOMEASSISTANT_TOKEN` (all required; init fails closed if missing).

## Session Log — 2026-06-13

### Done

- Diagnosed the green-when-broken gateway + each dead server to root cause.
- PR #1155 on `feature/mcp-gateway-fastmail-official` (commit `9eba98848`): official Fastmail, HA auth, drop sonos, gmail non-fatal, panicIfInvalid, Renovate-tracked npm pins.
- Set FASTMAIL_TOKEN, GMAIL_TOKEN, HOMEASSISTANT_TOKEN in 1Password; verified Fastmail (19 tools) + HA (200) endpoints with the real tokens.

### Remaining

- Merge #1155 → ArgoCD deploys; confirm fastmail + home-assistant register (and the pod crashloops loudly if either token/endpoint is wrong, by design).
- Gmail follow-up: replace `@automatearmy/email-reader-mcp` with a server that completes init in-cluster.

### Caveats

- All three new 1Password keys are **required** — the init container fails closed; they're already populated, so don't clear them.
- `home-assistant` and `fastmail` are now `panicIfInvalid: true`: a wrong token or unreachable endpoint will crashloop the whole gateway (intentional — loud over silent).
- Fresh-worktree helm types are **committed**; if `setup.ts`/codegen deletes them, `git restore packages/homelab/src/cdk8s/generated/helm/` — do NOT re-run the flaky generator.
