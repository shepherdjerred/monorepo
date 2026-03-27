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

## Exceptions

### Built-in 1Password fields

Fields with `purpose: PASSWORD` or the default `credential` label on API Credential items **cannot be renamed** via the 1Password CLI. For these, the CDK8s `key:` uses the lowercase built-in name (`password`, `credential`) while the env var name is whatever the container expects.

Affected items: HA token, Groq, qBittorrent, Plex, Pokebot, ha-sentry-dsn, whisperbridge, and others using the default API Credential template.

### Upstream-required env var names

Some containers require specific env var names defined by upstream projects. The CDK8s env var key must match what the container expects, even if it differs from our canonical name:

- `GITHUB_TOKEN` — required by `@modelcontextprotocol/server-github` (mcp-gateway). 1Password key is `GH_TOKEN`, mapped to env var `GITHUB_TOKEN`.
- `WIREGUARD_PRIVATE_KEY` / `WIREGUARD_PRESHARED_KEY` — required by gluetun (qbittorrent). 1Password item is AirVPN Wireguard with keys `PRIVATE_KEY` / `PRESHARED_KEY`.

### Tailscale OAuth client

The Tailscale 1Password item stores OAuth credentials as `client_id` / `client_secret` (their actual field names). CDK8s maps `client_secret` → `TS_AUTHKEY` env var.

## Implementation Status (2026-03-27)

### Completed
- Config.fish (chezmoi template + live): all env vars renamed
- Toolkit: `PAGERDUTY_API_KEY` → `PAGERDUTY_TOKEN`
- Scout source code: `RIOT_API_TOKEN` → `RIOT_API_KEY`
- Homelab CDK8s: all `key:` values → UPPER_SNAKE_CASE (~26 files)
- CI scripts: `CF_*` → `CLOUDFLARE_*`, `S3_*` → `SEAWEEDFS_*`, `ARGOCD_TOKEN` → `ARGOCD_AUTH_TOKEN`
- Clauderon: `GITHUB_TOKEN` → `GH_TOKEN`, removed `PAGERDUTY_API_KEY` fallback
- Skills: grafana-helper, gitops-flow updated
- Glance Swift tests: updated env var names
- 1Password: ~14 items, ~80 fields renamed to UPPER_SNAKE_CASE
- Regression linter: `scripts/check-env-var-names.sh` + lefthook pre-commit

### TODO

- **Scout container rebuild**: source says `RIOT_API_KEY` but running container expects `RIOT_API_TOKEN`. CDK8s temporarily uses `RIOT_API_TOKEN` with a TODO comment. After rebuild, flip CDK8s env var to `RIOT_API_KEY` and remove the TODO.

## Future Work

### 1Password fields → kebab-case

The current convention uses UPPER_SNAKE_CASE for 1Password field labels to match env var names 1:1. This should be changed to **kebab-case** (e.g., `pagerduty-token` not `PAGERDUTY_TOKEN`) because:

- kebab-case is idiomatic for 1Password field labels
- Built-in fields (`password`, `credential`) are already lowercase and can't be renamed — kebab-case is consistent with them
- The 1:1 matching creates exceptions for every built-in field

The revised chain would be:
```
1Password field (kebab-case) → K8s Secret key (kebab-case) → CDK8s key: (kebab-case) → CDK8s env var: (UPPER_SNAKE_CASE)
```

Scope: rename ~80 UPPER_SNAKE_CASE fields back to kebab-case across ~14 1Password items, update all CDK8s `key:` values. No app code changes needed (env var names stay UPPER_SNAKE_CASE).
