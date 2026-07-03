# OpenTofu Infrastructure

Manages external resources (Cloudflare DNS, GitHub repo settings, SeaweedFS S3 buckets, the Tailscale ACL policy, Buildkite, the \*arr apps, an ArgoCD CI token, and the LAN Asus routers) with [OpenTofu](https://opentofu.org/).

## Structure

```text
tofu/
├── argocd/              # ArgoCD account token for Buildkite, stored in 1Password
├── arr/                 # Radarr/Sonarr/Prowlarr config, imported from the live instances
├── asuswrt/             # Asus routers & APs (custom provider, local-run only)
├── buildkite/           # Buildkite cluster + monorepo pipeline settings
├── cloudflare/          # DNS zones, bot management, email security (one .tf per domain)
├── github/              # Repository settings and branch rulesets
├── seaweedfs/           # SeaweedFS S3 bucket management (AWS provider, custom endpoint)
└── tailscale/           # Tailnet ACL policy (deny-by-default access control)
```

Each subdirectory is an independent root module with its own `backend.tf` (S3 state on SeaweedFS), `providers.tf`, and `variables.tf`.

## Prerequisites

- OpenTofu (`mise` manages the version)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — SeaweedFS credentials for the state backend (needed by every stack's `init`)
- Per-stack credentials:
  - `cloudflare` — `CLOUDFLARE_API_TOKEN`, `TF_VAR_cloudflare_account_id`
  - `github` — `TF_VAR_github_token` (fine-grained PAT, classic PAT, or GitHub App token)
  - `tailscale` — `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` (scope `acl`)
  - `buildkite` — `TF_VAR_buildkite_api_token`
  - `argocd` — ArgoCD admin credentials plus `OP_CONNECT_TOKEN` for the 1Password provider
  - `arr` — Radarr/Sonarr/Prowlarr API credentials (see `arr/providers.tf`)
  - `asuswrt` — `TF_VAR_asuswrt_username` / `TF_VAR_asuswrt_password`, the shared router/AP admin login

To validate `.tf` without state access: `tofu -chdir=<stack> init -backend=false && tofu -chdir=<stack> validate`.

## Usage

```bash
tofu -chdir=cloudflare init
tofu -chdir=cloudflare plan
tofu -chdir=cloudflare apply
```

Same pattern for every stack.

## CI/CD

The static Buildkite pipeline ([`.buildkite/pipeline.yml`](../../../../.buildkite/pipeline.yml)) drives these stacks via `packages/homelab/scripts/tofu-stack.ts`:

- **Every PR** (when tofu inputs change): `tofu plan` for `seaweedfs`, `tailscale`, `buildkite`, `arr`, `github`, and `cloudflare`.
- **On merge to main**: applies `seaweedfs`, `tailscale`, `buildkite`, and `arr` (`tofu-apply` step); `github` in its own no-retry step (GitHub API mutations are not idempotent on partial failure); and `cloudflare` after the ArgoCD sync step's TunnelBinding deletion gate.
- The `argocd` stack is operator-run only — it is not in the CI plan/apply loops.
- `asuswrt` is not in the CI loops either, and cannot be: the CI pod has tailnet-only egress and cannot reach the LAN routers. It is run by hand from a machine on both the LAN and the tailnet — see [`asuswrt/README.md`](asuswrt/README.md).

## What's Managed

### Cloudflare

Each domain gets its own `.tf` file (e.g. `scout-for-lol-com.tf`) containing:

| Resource                    | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `cloudflare_zone`           | DNS zone                                            |
| `cloudflare_bot_management` | AI bot blocking, crawler protection, fight mode     |
| `cloudflare_record` (SPF)   | `v=spf1 -all` (reject all email, except `sjer.red`) |
| `cloudflare_record` (DMARC) | `v=DMARC1; p=reject` policy                         |

Domains: `scout-for-lol.com`, `discord-plays-pokemon.com`, `better-skill-capped.com`, `clauderon.com`,
`jerredshepherd.com`, `jerred.is`, `ts-mc.net`, `sjer.red`, `glitter-boys.com`, `shepherdjerred.com`

### GitHub

Repository settings for `shepherdjerred/monorepo` and the `shepherdjerred` profile-README repo (`repos.tf`):
public visibility, auto-delete branches on merge, auto-merge enabled. The `monorepo` repo is **squash-only**
(`allow_squash_merge = true`, merge commits and rebase disabled), with the squashed commit's title taken from
the PR title and its body from the list of squashed commits.

The `monorepo` default-branch ruleset (`rulesets.tf`) enforces linear history, blocks deletion and
non-fast-forward pushes, and requires the `ci/merge-conflict` and aggregate `buildkite/monorepo/pr`
status checks. (The code-review gate — provider-neutral, Codex by default — feeds the aggregate
`buildkite/monorepo/pr` status rather than being its own required check.)

### SeaweedFS

All S3 buckets on the self-hosted SeaweedFS instance, managed via the AWS provider with a custom S3 endpoint.
Includes static site buckets, application storage (scout), and the tofu state backend bucket itself.

The `homelab-tofu-state` bucket has `prevent_destroy = true` since it stores state for all tofu modules.

### Tailscale

The tailnet ACL policy (`tailscale_acl`): `tagOwners`, access rules, Tailscale SSH, and policy `tests`. Moves the tailnet from implicit allow-all (every device trusted) to deny-by-default — the account owner keeps full access, non-admin humans get only the published `*.ts.net` apps, and tagged/untrusted devices are denied by default.

### Buildkite

The Buildkite cluster and the `monorepo` pipeline's Buildkite-side settings (repo, branch rules, visibility kept private, upload step). The committed `.buildkite/pipeline.yml` remains the pipeline definition.

### \*arr

Radarr/Sonarr/Prowlarr configuration imported from the live instances. Quality profiles and custom formats are owned by Recyclarr, and Radarr/Sonarr indexers by Prowlarr's application sync — neither is in this stack.

### ArgoCD

Mints the `buildkite` ArgoCD account token and writes it to 1Password for the CI sync steps.

### Asus routers

The RT-AX88U Pro router and the RT-AX88U / RT-BE86U access points — system settings, DHCP static leases, port forwards, and wireless networks — through the in-repo [`terraform-provider-asuswrt`](../../../terraform-provider-asuswrt/), installed via a local filesystem mirror. Local-run only; see [`asuswrt/README.md`](asuswrt/README.md) for the device table, the import flow, and the wireless write-path caveats.

## Adding a New Domain

1. Create `cloudflare/{domain-with-dashes}.tf`
2. Copy the pattern from an existing file (e.g. `scout-for-lol-com.tf`)
3. Update the zone name, resource names, and DMARC `rua` email
4. Run `tofu -chdir=cloudflare plan` to verify, then `apply`

To import existing Cloudflare records into state, use [`cf-terraforming`](https://github.com/cloudflare/cf-terraforming).

## State Backend

State is stored in a self-hosted SeaweedFS S3 bucket (`homelab-tofu-state`), split by module — each stack keeps its own `<stack>/terraform.tfstate` key.
