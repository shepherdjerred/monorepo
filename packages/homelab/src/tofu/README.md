# OpenTofu Infrastructure

Manages external resources with [OpenTofu](https://opentofu.org/), including infrastructure, platform organization settings, and replaceable application credentials for services such as Discord, OpenAI, Anthropic, and OpenRouter.

## Structure

```text
tofu/
├── argocd/              # ArgoCD account token for Buildkite, stored in 1Password
├── arr/                 # Radarr/Sonarr/Prowlarr config, imported from the live instances
├── asuswrt/             # Asus routers & APs (custom provider, local-run only)
├── buildkite/           # Buildkite cluster + monorepo pipeline settings
├── cloudflare/          # DNS zones, bot management, email security (one .tf per domain)
├── discord/             # Imported Discord bot application settings
├── github/              # Repository settings and branch rulesets
├── openai/              # OpenAI projects, users, roles, alerts, and service accounts
├── anthropic/           # Anthropic workspaces, members, invites, and API keys
├── openrouter/          # OpenRouter workspaces, guardrails, API keys, and BYOK
├── seaweedfs/           # SeaweedFS S3 bucket management (AWS provider, custom endpoint)
└── tailscale/           # Tailnet ACL policy (deny-by-default access control)
```

Each subdirectory is an independent root module with its own `backend.tf` (S3 state on SeaweedFS), `providers.tf`, and `variables.tf`.

## Prerequisites

- OpenTofu (`mise` manages the version)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — SeaweedFS credentials for the state backend (needed by every stack's `init`)
- Per-stack credentials:
  - `cloudflare` — `CLOUDFLARE_API_TOKEN`, `TF_VAR_cloudflare_account_id`, and `CLOUDFLARE_API_TOKENS_JSON`
  - `github` — `TF_VAR_github_token` (fine-grained PAT, classic PAT, or GitHub App token)
  - `tailscale` — `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` (scope `acl`)
  - `buildkite` — `TF_VAR_buildkite_api_token`
  - `argocd` — ArgoCD admin credentials plus `OP_CONNECT_TOKEN` for the 1Password provider
  - `arr` — Radarr/Sonarr/Prowlarr API credentials (see `arr/providers.tf`)
  - `asuswrt` — `TF_VAR_asuswrt_username` / `TF_VAR_asuswrt_password`, the shared router/AP admin login
  - `discord` — `DISCORD_BOTS_JSON` and `DISCORD_BOT_TOKENS_JSON`
  - `openai` — `OPENAI_ADMIN_KEY` plus the OpenAI JSON configuration variables
  - `anthropic` — `ANTHROPIC_ADMIN_KEY` plus the Anthropic JSON configuration variables
  - `openrouter` — management `OPENROUTER_API_KEY` plus the OpenRouter JSON configuration variables, including the separately injected `OPENROUTER_BYOK_KEYS_JSON`; set a new `rotation_version` in a BYOK registry entry when deliberately rotating its write-only key
  - all stacks — `TOFU_STATE_ENCRYPTION_PASSPHRASE`; platform stacks that write handoffs also need `OP_CONNECT_TOKEN` and `OP_CONNECT_URL`

The JSON variables are injected by `packages/homelab/scripts/tofu-stack.ts`; they are not checked-in tfvars. Vendor bootstrap/admin credentials remain outside OpenTofu state and are populated from 1Password at the CI/operator boundary.

To validate `.tf` without state access: `tofu -chdir=<stack> init -backend=false && tofu -chdir=<stack> validate`.

## Usage

Run the wrapper from the repository root so it can translate the documented
source environment names into the stack's `TF_VAR_*` inputs and enforce the
required registry and migration gates. The checked-in env file contains only
1Password references:

```bash
op run --env-file=packages/homelab/src/tofu/.env -- \
  bun packages/homelab/scripts/tofu-stack.ts cloudflare plan
op run --env-file=packages/homelab/src/tofu/.env -- \
  bun packages/homelab/scripts/tofu-stack.ts cloudflare apply
```

Use the same wrapper command with another stack name. Direct `tofu -chdir`
commands bypass the credential allowlist, registry checks, state passphrase
mapping, and encrypted-state migration gate.

## CI/CD

The static Buildkite pipeline ([`.buildkite/pipeline.yml`](../../../../.buildkite/pipeline.yml)) drives these stacks via `packages/homelab/scripts/tofu-stack.ts`:

- **Every PR** (when tofu inputs change): static formatting and validation for the Tofu modules. Live plans do not run in PR-controlled pods because they would require production state-backend and vendor-admin credentials.
- **On merge to main**: applies `seaweedfs`, `tailscale`, `buildkite`, and `arr` (`tofu-apply` step); `github` in its own no-retry step (GitHub API mutations are not idempotent on partial failure); and `cloudflare` after the ArgoCD sync step's TunnelBinding deletion gate.
- The `argocd` stack is operator-run only — it is not in the CI plan/apply loops.
- `asuswrt` is not in the CI loops either, and cannot be: the CI pod has tailnet-only egress and cannot reach the LAN routers. It is run by hand from a machine on both the LAN and the tailnet — see [`asuswrt/README.md`](asuswrt/README.md).

Until the encrypted-state migration has been verified for every existing remote
object, `tofu-stack.ts ... apply` refuses to run unless
`TOFU_STATE_ENCRYPTION_MIGRATION_APPROVED=true` is supplied at the operator or
Buildkite boundary. Set it only after checking the encrypted state passphrase,
remote object, and restore path. Remove the fallback and this temporary gate in
a separately reviewed migration-completion change.

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

Scoped `cloudflare_api_token` resources can be declared in `cloudflare_api_tokens`. The bootstrap token and legacy global API key remain manual. Generated token values are handed to concealed 1Password items when a `handoff_title` is configured.

### Discord

`discord/bot-registry.json` is the checked-in allowlist of true bot applications, expected application IDs, 1Password item references, and managed settings. `discord/applications.tf` is import-only. OpenTofu requires provider configurations and provider selections to be static, so the stack declares one alias and one resource for each registry entry; add a registry entry and its static blocks before managing a new bot. Each bot manages descriptions, install URLs, interaction endpoints, role-connection URLs, and tags. Every application has `prevent_destroy`; applications are never created or deleted by this stack.

Bot tokens remain Developer Portal/1Password-managed. Userbots/selfbots, guild layout, commands, and bot-token rotation are intentionally outside this stack.

### OpenAI

The official `openai/openai` provider manages projects, imported organization users, project roles, and spend alerts. The pinned companion provider is used only for project service-account resources that return a newly-created API key; the generated key is written to a concealed 1Password item. OpenAI subscription/Codex authentication is a separate credential boundary.

### Anthropic

The pinned `terraform-mars/anthropic` provider manages workspaces, workspace members, invites, and API keys. Generated API keys are written to concealed 1Password items. Organization/admin access is required; portal-only and unsupported Admin API surfaces remain manual.

### OpenRouter

The pinned `cloudopsworks/openrouter` provider manages workspaces, guardrails, and inference API keys. The local `terraform-provider-openrouter-byok` provider covers the upstream provider's missing BYOK resource, including create/read/update/delete, write-only key handling, 404 removal, and replacement-on-key-rotation. OpenRouter management keys are bootstrap credentials and are never used as application inference keys.

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

Every stack now encrypts state and saved plans client-side with AES-GCM using a PBKDF2 key derived from `TOFU_STATE_ENCRYPTION_PASSPHRASE` (at least 16 characters). The passphrase is injected from 1Password and never committed. An unencrypted fallback is retained only for the migration/read path; after each existing state has been opened and rewritten successfully, remove that fallback in a separately reviewed migration change. Verify the remote object and restore/unlock path before creating any generated credential resource.

OpenTofu state is authoritative for generated credential lifecycle, while 1Password is the runtime handoff. A generated secret is treated as write-once: do not blindly retry a failed create. Inspect the encrypted state and corresponding 1Password item first, then resume deliberately. Destroy revokes the vendor credential; changing a key input forces replacement.
