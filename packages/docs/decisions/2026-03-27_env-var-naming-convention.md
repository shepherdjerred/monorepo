# Environment Variable Naming Convention

Date: 2026-03-27

## Context

Audit found the same credential referenced by 2-3 different names across config.fish, toolkit, clauderon, homelab CDK8s, CI scripts, 1Password items, and Claude skills. This caused silent failures (e.g., `toolkit gf logs` failing because config.fish set `GRAFANA_SERVER` but toolkit reads `GRAFANA_URL`).

## Convention

**One name per credential, used identically at every layer:**

```
1Password field label = K8s Secret key = container env var = CI env var = config.fish export
```

All use `UPPER_SNAKE_CASE`. No kebab-case, no snake_case, no aliases.

## Canonical Names

| Service | Canonical env var |
|---|---|
| Grafana | `GRAFANA_URL`, `GRAFANA_API_KEY` |
| PagerDuty | `PAGERDUTY_TOKEN` |
| Riot Games | `RIOT_API_KEY` |
| Discord | `DISCORD_TOKEN` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| ArgoCD | `ARGOCD_AUTH_TOKEN` |
| Buildkite | `BUILDKITE_API_TOKEN` |
| Bugsink | `BUGSINK_URL`, `BUGSINK_TOKEN` |
| GitHub | `GH_TOKEN` |
| Sentry | `SENTRY_AUTH_TOKEN`, `SENTRY_DSN` |
| Tailscale | `TS_AUTHKEY` |
| Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| Cloudflare R2 | `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY` |
| SeaweedFS | `SEAWEEDFS_ACCESS_KEY_ID`, `SEAWEEDFS_SECRET_ACCESS_KEY` |

## Banned Names

These are enforced by `scripts/check-env-var-names.sh` (lefthook pre-commit).

| Banned pattern | Use instead |
|---|---|
| `GRAFANA_SERVER` | `GRAFANA_URL` |
| `GRAFANA_TOKEN` | `GRAFANA_API_KEY` |
| `PAGERDUTY_API_KEY` | `PAGERDUTY_TOKEN` |
| `PAGERDUTY_API_TOKEN` | `PAGERDUTY_TOKEN` |
| `RIOT_API_TOKEN` | `RIOT_API_KEY` |
| `GITHUB_TOKEN` | `GH_TOKEN` |
| `BUGSINK_API_TOKEN` | `BUGSINK_TOKEN` |
| `ARGOCD_TOKEN` | `ARGOCD_AUTH_TOKEN` |
| `CF_ACCOUNT_ID` | `CLOUDFLARE_ACCOUNT_ID` |
| `CF_R2_ACCESS*` | `CLOUDFLARE_R2_ACCESS_KEY_ID` |
| `CF_R2_SECRET*` | `CLOUDFLARE_R2_SECRET_ACCESS_KEY` |
| `S3_ACCESS_KEY*` | `SEAWEEDFS_ACCESS_KEY_ID` |
| `S3_SECRET_ACCESS*` | `SEAWEEDFS_SECRET_ACCESS_KEY` |
| `TS_AUTH_KEY` | `TS_AUTHKEY` |

## Rationale for each choice

- **`PAGERDUTY_TOKEN`** — Terraform provider and go-pagerduty convention
- **`RIOT_API_KEY`** — Community convention (cassiopeia, shieldbow, twisted)
- **`GH_TOKEN`** — gh CLI's preferred name (checked before `GITHUB_TOKEN`)
- **`ARGOCD_AUTH_TOKEN`** — Official argocd CLI docs
- **`TS_AUTHKEY`** — Official Tailscale container docs (no underscore before KEY)
- **`CLOUDFLARE_*`** — Official Terraform provider prefix (not `CF_`)
- **`SEAWEEDFS_*`** — Identifies the backend (not generic `S3_`)
