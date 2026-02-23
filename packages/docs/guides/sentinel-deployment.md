# Sentinel Deployment Guide

## Prerequisites

Sentinel's CI/CD pipeline is fully wired — image build, Helm chart, ArgoCD app, and GHCR publishing all happen automatically on merge to main. The only manual steps are creating secrets and updating the 1Password reference.

## Manual Steps

### 1. Create 1Password Item

Create a new item named "Sentinel" in the Kubernetes vault with these fields:

| Field | Description |
|-------|-------------|
| `anthropic-api-key` | Claude API key for Agent SDK |
| `discord-token` | Discord bot token for sentinel |
| `discord-channel-id` | Channel ID for notifications |
| `discord-guild-id` | Guild ID for slash commands |
| `github-token` | GitHub token (scopes: `repo:status`, `public_repo`, `actions:read`, `contents:read`) |
| `github-webhook-secret` | Secret for GitHub webhook signature verification |
| `pagerduty-webhook-secret` | Secret for PagerDuty webhook signature verification |
| `bugsink-webhook-secret` | Token for Bugsink webhook URL path authentication |
| `buildkite-webhook-token` | Token for Buildkite webhook `X-Buildkite-Token` verification |
| `buildkite-api-token` | Buildkite API token for agents to read build logs |
| `pagerduty-api-token` | PagerDuty API token for agents to triage/acknowledge incidents |
| `bugsink-api-token` | Bugsink API token for agents to query error details |
| `sentry-dsn` | Sentry DSN for error tracking |

### 2. Update 1Password UUID

After creating the 1Password item, get its UUID:

```bash
op item get "Sentinel" --vault "Kubernetes" --format json | jq -r '.id'
```

Replace the placeholder in `packages/homelab/src/cdk8s/src/resources/sentinel/index.ts`:

```typescript
// Change this:
itemPath: vaultItemPath("sentinel"),
// To this (with actual UUID):
itemPath: vaultItemPath("abc123defghijklmnop"),
```

### 3. Configure Webhook Endpoints

After deployment, sentinel exposes webhooks via TailscaleIngress with funnel at `sentinel-webhooks`:

| Provider | URL | Auth Method |
|----------|-----|-------------|
| GitHub | `https://sentinel-webhooks.tailnet-1a49.ts.net/webhook/github` | `X-Hub-Signature-256` (HMAC sha256) |
| PagerDuty | `https://sentinel-webhooks.tailnet-1a49.ts.net/webhook/pagerduty` | `X-PagerDuty-Signature` (HMAC v1) |
| Buildkite | `https://sentinel-webhooks.tailnet-1a49.ts.net/webhook/buildkite` | `X-Buildkite-Token` (plain token) |
| Bugsink | `https://sentinel-webhooks.tailnet-1a49.ts.net/webhook/bugsink/<token>` | Token in URL path |

Configure each provider to send webhooks to the corresponding URL.

**Buildkite setup**: In Buildkite org settings > Notification Services > Webhooks, add a webhook with the URL above. Set the token to the `buildkite-webhook-token` value from 1Password. Subscribe to `build.finished` events.

**Bugsink setup**: In each Bugsink project's webhook settings, set the URL to the Bugsink URL above with the `bugsink-webhook-secret` value from 1Password appended as the path token. The same URL is used for all 7 projects.

### 4. Register Discord Bot

1. Create a Discord application at https://discord.com/developers
2. Add the bot to your guild with `applications.commands` and `bot` scopes
3. Bot permissions needed: Send Messages, Embed Links, Use Slash Commands
4. The `/sentinel` slash commands (status, approve, deny) register automatically on startup

### 5. Push to Main

Merge to main triggers the full pipeline:

1. Dagger builds the container image
2. Publishes to `ghcr.io/shepherdjerred/sentinel` with digest
3. Publishes Helm chart to ChartMuseum
4. Updates `versions.ts` with pinned digest
5. ArgoCD syncs the deployment to the cluster

## Deployment Architecture

- **Replicas**: 1 (required — SQLite doesn't support concurrent access)
- **Strategy**: Recreate (not rolling — prevents two pods hitting the same DB)
- **Storage**: 5Gi ZFS NVMe persistent volume at `/app/data` (SQLite DB, conversations, memory)
- **Health probes**: `/livez` (liveness), `/healthz` (readiness) on port 3000
- **Networking**: TailscaleIngress with funnel for public webhook access

## Verification

After deployment:

```bash
# Check pod is running
kubectl -n sentinel get pods

# Check health
curl https://sentinel-webhooks.<tailnet>/healthz

# Check queue stats
curl https://sentinel-webhooks.<tailnet>/metrics

# Check ArgoCD sync
argocd app get sentinel
```
