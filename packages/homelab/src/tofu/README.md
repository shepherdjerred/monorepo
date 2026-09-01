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
├── cloudflare-tokens/   # Scoped API tokens, isolated from the DNS stack
├── discord/             # Imported Discord bot application settings
├── github/              # Repository settings and branch rulesets
├── openai/              # OpenAI projects, users, roles, alerts, and service accounts
├── anthropic/           # Anthropic workspaces, members, and imported API-key metadata
├── openrouter/          # OpenRouter workspaces, guardrails, API keys, and BYOK
├── posthog/             # PostHog organization and project controls
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
  - `discord` — one bot token per imported application plus `TOFU_STATE_ENCRYPTION_PASSPHRASE`
  - `openai` — `OPENAI_ADMIN_KEY`, `OPENAI_CERTIFICATE_VALUES_JSON`, and `TOFU_STATE_ENCRYPTION_PASSPHRASE`
  - `anthropic` — `ANTHROPIC_ADMIN_API_KEY` and `TOFU_STATE_ENCRYPTION_PASSPHRASE`
  - `openrouter` — `OPENROUTER_MANAGEMENT_KEY`, `OPENROUTER_BYOK_KEYS_JSON`, and `TOFU_STATE_ENCRYPTION_PASSPHRASE`
  - `cloudflare-tokens` — a bootstrap `CLOUDFLARE_API_TOKEN` and `TOFU_STATE_ENCRYPTION_PASSPHRASE`

Non-secret platform desired state is committed in each platform stack's
`desired-state.json` and checked against `platform-desired-state.schema.json`.
`packages/homelab/scripts/tofu-stack.ts` injects that state as typed variables
and builds every child environment from an allowlist. Vendor admin keys,
generated credentials, BYOK values, certificate material, bot tokens, and each
stack's unique state passphrase remain in 1Password.

To validate without state or platform access, run
`bun packages/homelab/scripts/tofu-stack.ts <stack> validate`.

## Usage

The platform stacks must be run through the wrapper so their committed
desired-state registries and allowlisted credentials are injected:

```bash
bun packages/homelab/scripts/tofu-stack.ts openai plan
bun packages/homelab/scripts/tofu-stack.ts openai apply
```

For the established infrastructure stacks, direct OpenTofu commands remain
supported when their variables and backend credentials are supplied manually:

```bash
tofu -chdir=cloudflare init
tofu -chdir=cloudflare plan
tofu -chdir=cloudflare apply
```

## CI/CD

The static Buildkite pipeline ([`.buildkite/pipeline.yml`](../../../../.buildkite/pipeline.yml)) drives these stacks via `packages/homelab/scripts/tofu-stack.ts`:

- **Every PR** (when tofu inputs change): credentialed plans for the established infrastructure stacks and backend-disabled validation with dummy encryption values for the five platform stacks.
- **On merge to main**: applies `seaweedfs`, `tailscale`, `buildkite`, and `arr` (`tofu-apply` step); `github` in its own no-retry step (GitHub API mutations are not idempotent on partial failure); and `cloudflare` after the ArgoCD sync step's TunnelBinding deletion gate.
- **Platform control planes on main**: separate, serialized, no-retry jobs for `openai`, `anthropic`, `discord`, `openrouter`, and `cloudflare-tokens`. Ordinary main builds plan only. An operator sets `TOFU_PLATFORM_APPLY` to exactly one stack name on a targeted main build to run that stack's plan and apply; the selector omits the other four jobs. Each job receives only its own platform credentials and the shared state identity.
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
`jerredshepherd.com`, `ts-mc.net`, `sjer.red`, `glitter-boys.com`, `shepherdjerred.com`

Scoped `cloudflare_api_token` resources live in the isolated
`cloudflare-tokens` state. The bootstrap token and legacy global API key remain
manual. A generated token value is exposed only as a sensitive handoff paired
with its existing 1Password rotation unit; an operator writes and proves that
handoff before revoking the superseded token.

The committed registry creates a distinct replacement for Buildkite, the
Temporal audit worker, local `cf` tooling, cloudflare-operator, the R2 exporter,
and DDNS. Each entry records the active token ID it supersedes, readable
permission names plus their stable Cloudflare IDs, exact account or zone
resources, and the existing 1Password field or JSON path. The Buildkite and
Temporal entries deliberately split their currently shared credential. The
bootstrap identity must have API Tokens Read and Write; ordinary consumer
tokens do not receive token-administration permissions.

### Discord

`discord/desired-state.json` is the checked-in allowlist of true bot
applications, expected application IDs, 1Password item references, and managed
settings. `discord/applications.tf` is import-only. Each bot has its own
provider configuration and manages descriptions, install URLs, interaction
endpoints, role-connection URLs, and tags. Every application has
`prevent_destroy`; applications are never created or deleted by this stack.

Bot tokens remain Developer Portal/1Password-managed. Userbots/selfbots, guild layout, commands, and bot-token rotation are intentionally outside this stack.

### OpenAI

The official `openai/openai` provider manages projects, imported organization
users, roles, permissions, certificates, rate limits, and spend controls. The
pinned `jianyuan/openai` companion is used only for project service accounts
because that resource returns the newly created key. The sensitive output pairs
that key with one or more existing 1Password rotation units for the
operator-controlled handoff. Existing projects carry their permanent import IDs;
new service accounts are limited to the Streambot and OpenRouter BYOK rotations.
OpenAI subscription/Codex authentication is a separate boundary.

### Anthropic

The pinned `ippontech/anthropic` provider manages workspaces, members, and
imported API-key metadata. Its API-key resource is import-only and never returns
secret material, so invitations and rotated key creation remain documented
manual bootstrap steps. The committed key metadata records the existing
1Password rotation unit, including a JSON path when needed, that receives a
manually created replacement.

### OpenRouter

The official pinned `OpenRouterTeam/openrouter` provider manages workspaces,
guardrails, and inference API keys. Every current workspace and supported
inference key is committed with its import ID and exact live settings before
replacement keys are created. Generated keys name their existing 1Password targets; imported external
keys may intentionally have no repository handoff. OpenRouter management keys
are bootstrap credentials and are never used as application inference keys.

**BYOK credentials are deliberately NOT managed here.** `openrouter_byok_key`
declares `key` — the raw upstream Anthropic/OpenAI API key — as a _required_
attribute, and OpenRouter never returns it, so OpenTofu cannot read an existing
credential and cannot avoid pushing a value. Nor can it mint one: across every
resource and data source of both the `ippontech/anthropic` and `openai/openai`
providers there is no computed+sensitive attribute at all. `anthropic_api_key`
exposes only `partial_key_hint`, and `openai_project_service_account` exposes no
key attribute, so the secret can only enter from outside OpenTofu.

Managing BYOK here would therefore require both provider keys to sit in a
CI-readable 1Password field, granting every Buildkite job holding that grant
standing access to them — a permanent cost paid to version-control a few
policy fields (`allowed_models`, `disabled`, `is_fallback`, workspace binding)
that change rarely. BYOK is instead wired by hand in the OpenRouter UI, and
`openrouter_byok_credentials` is an empty map.

To adopt them later: populate `OPENROUTER_BYOK_KEYS_JSON` on the
`openrouter-tofu-credentials` item with `{"<name>": "<raw provider key>"}` and
add the matching entries (with their `byok_key_id`) back to
`desired-state.json`. The resource, variables, and import wiring all remain in
place, and `assertPlatformSecretCoverage` in `tofu-stack.ts` fails fast naming
any credential whose key is missing. Note that whatever value is supplied
becomes what OpenRouter stores — if it differs from the key wired today, the
apply rotates the credential rather than adopting it.

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

State is stored in a self-hosted SeaweedFS S3 bucket
(`homelab-tofu-state`), split by module. The new `openai`, `anthropic`,
`discord`, `openrouter`, and `cloudflare-tokens` states enforce client-side
AES-GCM encryption for state and saved plans from their first write. They have
no plaintext fallback because no prior remote object exists.

The eight established plaintext states are deliberately unchanged. Their
backup, migration, restore proof, and enforcement are tracked in
[SJ-171](https://linear.app/sjerred/issue/SJ-171/enforce-encryption-for-eight-legacy-opentofu-states);
do not add a fallback or flip enforcement casually in an unrelated provider
change.

OpenTofu state is authoritative for generated credential lifecycle, while
1Password is the runtime handoff. Treat a generated secret as write-once: do
not blindly retry a failed create. Inspect the encrypted state and intended
rotation unit first, then resume deliberately. Revoke the old credential only
after its consumer proves the replacement is active.
