# OpenTofu Infrastructure

Manages external resources with [OpenTofu](https://opentofu.org/), including infrastructure, platform organization settings, and replaceable application credentials for services such as Discord, OpenAI, Anthropic, and Google.

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
├── anthropic-federation/ # Anthropic workload identity federation (operator-applied)
├── google/              # Per-workload Gemini API projects and budgets (operator-applied)
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
  - `anthropic-federation` — `ANTHROPIC_ADMIN_API_KEY`, an `org:admin` OAuth token as `ANTHROPIC_AUTH_TOKEN`, `OP_ACCOUNT` for the 1Password provider's desktop-app auth, and `TOFU_STATE_ENCRYPTION_PASSPHRASE`
  - `google` — the operator's Application Default Credentials, `OP_ACCOUNT` for the 1Password provider's desktop-app auth, and `TOFU_STATE_ENCRYPTION_PASSPHRASE`
  - `cloudflare-tokens` — a bootstrap `CLOUDFLARE_API_TOKEN` and `TOFU_STATE_ENCRYPTION_PASSPHRASE`

Non-secret platform desired state is committed in each platform stack's
`desired-state.json` and checked against `platform-desired-state.schema.json`.
`packages/homelab/scripts/tofu/tofu-stack.ts` injects that state as typed variables
and builds every child environment from an allowlist. Vendor admin keys,
generated credentials, certificate material, bot tokens, and each
stack's unique state passphrase remain in 1Password.

To validate without state or platform access, run
`bun packages/homelab/scripts/tofu/tofu-stack.ts <stack> validate`.

## Usage

The platform stacks must be run through the wrapper so their committed
desired-state registries and allowlisted credentials are injected:

```bash
bun packages/homelab/scripts/tofu/tofu-stack.ts openai plan
bun packages/homelab/scripts/tofu/tofu-stack.ts openai apply
```

For the established infrastructure stacks, direct OpenTofu commands remain
supported when their variables and backend credentials are supplied manually:

```bash
tofu -chdir=cloudflare init
tofu -chdir=cloudflare plan
tofu -chdir=cloudflare apply
```

## CI/CD

The static Buildkite pipeline ([`.buildkite/pipeline.yml`](../../../../.buildkite/pipeline.yml)) drives these stacks via `packages/homelab/scripts/tofu/tofu-stack.ts`:

- **Every PR** (when tofu inputs change): credentialed plans for the established infrastructure stacks and backend-disabled validation with dummy encryption values for the five platform stacks.
- **On merge to main**: applies `seaweedfs`, `tailscale`, `buildkite`, and `arr` (`tofu-apply` step); `github` in its own no-retry step (GitHub API mutations are not idempotent on partial failure); and `cloudflare` after the ArgoCD sync step's TunnelBinding deletion gate.
- **Platform control planes on main**: separate, serialized, no-retry jobs for `openai`, `anthropic`, `discord`, and `cloudflare-tokens`. Ordinary main builds plan only. An operator sets `TOFU_PLATFORM_APPLY` to exactly one stack name on a targeted main build to run that stack's plan and apply; the selector omits the other three jobs. `anthropic-federation` and `google` validate on PRs but have no CI plan or apply job: their credentials are an operator's OAuth token and ADC, so an operator applies them locally through the wrapper. Each job receives only its own platform credentials and the shared state identity.
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
every inference workload and environment has its own project and service
account, with a hard spend limit, a spend alert, and a model allowlist. The
`openrouter` project and its BYOK service account remain only until the
OpenRouter keys are revoked after live acceptance. OpenAI subscription/Codex authentication is a separate
boundary.

Spend controls denominate their thresholds inconsistently upstream, and the
committed values rely on it: `openai_project_spend_limit` /
`openai_organization_spend_limit` take **cents** (the provider documents
"Hard spend limit amount, in cents"), while the `*_spend_alert` resources take
**whole currency units**. The Scout entries therefore read `2500` for a $25
monthly hard cap and `10` for a $10 alert. Do not "normalize" one to match the
other.

### Anthropic

The pinned `ippontech/anthropic` provider manages workspaces, members, and
imported API-key metadata. Its API-key resource is import-only and never returns
secret material, so invitations and rotated key creation remain documented
manual bootstrap steps. The committed key metadata records the existing
1Password rotation unit, including a JSON path when needed, that receives a
manually created replacement.

### Anthropic workload identity federation

The `anthropic-federation` stack registers the Talos cluster's service-account
token issuer with inline JWKS, because the issuer is not publicly reachable. It
creates one Anthropic service account and federation rule per workload, each
matching `system:serviceaccount:<namespace>:*` and bound to that environment's
workspace. Federated pods hold no Anthropic secret. The apply writes each
workload's organization, rule, service account, and workspace IDs into a
dedicated 1Password item named by its `onepassword_item_title`, which CDK8s
syncs into the workload's namespace, so an apply needs no follow-up commit.

The federation admin endpoints accept only an `org:admin` OAuth token, so this
stack is operator-applied. Workspace spend limits are not exposed by the
provider and are set in the Claude Console.

### Google

The `google` stack creates one project per workload with the Gemini API
enabled, a role-less service account to bind the key to, and an alert-only
Cloud Billing budget. It mints a Gemini API key bound to that account and
restricted to the Gemini API, and writes it into a dedicated 1Password item
named by the workload's `onepassword_item_title`. Bumping
`gemini_key_revision` rotates the key: the replacement is created and handed
off before the old one is deleted. The AI Studio spend cap has no API; the
output `google_gemini_spend_caps` lists the value to set by hand. Without a
GCP organization only a user can create projects, so this stack runs with the
operator's Application Default Credentials. `google_billing_account_id` and
`google_quota_project_id` are unset until the billing account exists.

See [Rotate LLM provider credentials](https://github.com/shepherdjerred/monorepo/blob/main/packages/docs/wiki/src/content/docs/how-to/rotate-provider-credentials.md)
for the operator steps, spend caps, and JWKS refresh.

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
`discord`, `anthropic-federation`, `google`, and `cloudflare-tokens` states
enforce client-side
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
