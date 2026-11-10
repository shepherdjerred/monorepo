# OpenTofu Infrastructure

Manages external resources with [OpenTofu](https://opentofu.org/), including infrastructure, platform organization settings, and replaceable application credentials for services such as Discord, OpenAI, Anthropic, and Google.

Local application credential adoption is available in
[`application-secrets`](application-secrets/README.md). Its wrapper permits
validation and operator-only, preserve-value adoption at an exact source
revision. General apply and rotation remain disabled. The read-only vault audit
and handoff previews support review without CI vault-write access.

## Structure

```text
tofu/
├── argocd/              # Scoped ArgoCD account tokens, stored in 1Password
├── arr/                 # Radarr/Sonarr/Prowlarr config, imported from the live instances
├── asuswrt/             # Asus routers & APs (custom provider, local-run only)
├── backblaze/           # Backup buckets and scoped keys; Velero writes to sjerred-velero (operator-applied)
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

### Stacks synthesized from TypeScript

`github` has no `.tf` files. Its configuration is
`main.tf.json`, synthesized by the [CDK Terrain](https://cdktn.io/docs) app in
[`packages/homelab-cdktn`](../../../homelab-cdktn) and committed next to the stack's `.terraform.lock.hcl`.
OpenTofu, `tofu-stack.ts`, the stack archive and Delivery read that file like
any other configuration; nothing synthesizes at plan or apply time. Never edit
`main.tf.json` by hand:

```bash
bunx turbo run generate --filter=@homelab/cdktn   # provider bindings (cdktn get, needs tofu and Node)
bun run --cwd packages/homelab-cdktn synth    # rewrite src/tofu/<stack>/main.tf.json
bunx turbo run build test --filter=@homelab/cdktn # fails when a committed file is stale
```

A stack holds either hand-written HCL or a synthesized `main.tf.json`, never
both; `tofu-stack.ts` refuses a directory that mixes them. Resource addresses
are the construct ids in `packages/homelab-cdktn/src/stacks/<stack>.ts`, so renaming one is a
state change. A synthesized stack is accepted only on a plan against live state
that reports no changes.

### Provider versions

`provider-versions.json` in this directory is the one place a provider version
is pinned. Bindings are generated for the entries marked `"bindings": true`, at
exactly the pinned version, and a synthesized stack's lock file must select
that same version; the `@homelab/cdktn` tests fail otherwise. The stack runner
also builds the repository-owned AsusWRT provider at the version pinned there.

Renovate bumps a pin through a regex manager. Renovate here is Mend-hosted and
cannot run commands after an upgrade, so a pin bump is finished by hand on its
branch:

```bash
bun run --cwd packages/homelab-cdktn providers:refresh            # every synthesized stack
bun run --cwd packages/homelab-cdktn providers:refresh -- argocd  # named stacks, either format
bun run --cwd packages/homelab-cdktn providers:refresh -- --check # report only
```

It moves each stack's `.terraform.lock.hcl` to the pins, regenerates the
bindings and re-synthesizes. It reads provider registries and never
initializes a backend. A lock moved to a new version is a provider upgrade:
accept it on a plan against live state like any other stack change.

A hand-written HCL stack keeps its own `required_providers` constraints and
its lock is still maintained by Renovate's terraform manager, so it may differ
from the pin until the stack is ported.

## Prerequisites

- OpenTofu (`mise` manages the version)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — SeaweedFS credentials for the state backend (needed by every stack's `init`)
- Per-stack credentials:
  - `cloudflare` — `CLOUDFLARE_API_TOKEN`, `TF_VAR_cloudflare_account_id`
  - `github` — `TF_VAR_github_token` (fine-grained PAT, classic PAT, or GitHub App token)
  - `tailscale` — `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` (scope `acl`)
  - `argocd` — the `tofu-argocd` account's token as `TOFU_ARGOCD_AUTH_TOKEN` (`argocd.env`) plus `OP_SERVICE_ACCOUNT_TOKEN` for 1Password item writes
  - `dockerhub` — `DOCKERHUB_USERNAME`, the repository-management PAT `DOCKERHUB_MANAGEMENT_TOKEN`, and `TOFU_STATE_ENCRYPTION_PASSPHRASE`
  - `arr` — Radarr/Sonarr/Prowlarr API credentials (see `arr/providers.tf`)
  - `asuswrt` — `TF_VAR_asuswrt_username` / `TF_VAR_asuswrt_password`, the shared router/AP admin login
  - `backblaze` — master `B2_APPLICATION_KEY_ID` / `B2_APPLICATION_KEY` for an account in `us-west-004`, `OP_ACCOUNT` for the 1Password provider's desktop-app auth, and `TOFU_STATE_ENCRYPTION_PASSPHRASE`
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

### Unattended local 1Password access

The `argocd` stack updates an item in the homelab vault. The Connect token used
by the in-cluster operator can read this vault but cannot write it. Desktop app
authentication prompts for each provider or CLI invocation. Use a separate
1Password service account for operator-run work:

1. In 1Password.com, create a service account with **Read Items** and **Write
   Items** access only to the homelab vault (`v64ocnykdqju4ui6j6pua56xw4`).
   Leave vault creation and access to other vaults disabled. Save the token in
   your Personal vault, which service accounts cannot access.
2. On the operator's Mac, copy the newly issued token into the login Keychain
   once with the enrollment helper. It accepts the full token as hidden terminal
   input, validates it with service-account authentication, and updates the
   Keychain entry. The `security add-generic-password -w` password prompt can
   truncate long tokens, so do not use it here. Do not paste the token into a
   shell argument, environment file, terminal output, or repository file:

   ```bash
   swift scripts/onepassword/enroll-service-account.swift
   ```

3. Prefix commands that need this vault with the wrapper. It reads the token
   from Keychain into the child process environment without invoking desktop
   authentication. An already supplied `OP_SERVICE_ACCOUNT_TOKEN` also works
   on non-macOS hosts. The separate `service-account.env` contains only vault
   references the service account can read; the general `.env` also contains
   Personal vault references. The ArgoCD plan or apply adds `argocd.env`, the
   `tofu-argocd` account's token. Do not print the token:

   ```bash
   scripts/onepassword/with-service-account.sh op vault list
   scripts/onepassword/with-service-account.sh \
     op run --env-file packages/homelab/src/tofu/service-account.env \
     --env-file packages/homelab/src/tofu/argocd.env -- \
     bun packages/homelab/scripts/tofu/tofu-stack.ts argocd plan
   ```

The service account's vault access and permissions are fixed at creation. Revoke
and replace it if the token is exposed or the scope needs to change. The same
wrapper works for the vault snapshot command; it does not change Kubernetes
operator credentials or grant CI jobs write access.

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

Woodpecker runs backend-disabled OpenTofu validation on PRs when infrastructure
inputs change, without provider or remote-state credentials. CI does not plan
or apply infrastructure.

Every default-branch build also freezes each stack as an immutable,
content-addressed archive (`s3://delivery-artifacts/tofu/<stack>/<digest>.tar`)
and registers it with Delivery under the `tofu-<stack>` service. An archive
holds the stack directory under its repository path, including
`.terraform.lock.hcl` and local `modules/`, plus the repository files the
stack's `externalFiles` entry in `scripts/tofu/tofu-stack-manifest.ts`
declares; `.terraform/`, state, saved plans, `tests/` and `desired-state.json`
are left out. A configuration that reads a file outside its directory must
declare it there: `bun run lint:tofu` and the homelab test suite fail on an
undeclared read, an unread declaration, or a declared file that does not
exist. Every `backend.tf` sets `use_lockfile = true`, so concurrent runs
serialize on the state bucket's lock object rather than on a shared checkout.

Delivery owns operational plans and applies for registered stacks. Applies
consume the exact encrypted saved plan; stacks marked `reviewed-plan` require
a human decision on that plan. Stack modes and prerequisites are declared in
`packages/ops-model/platform-policy.json`.

Delivery plans and applies `dockerhub` automatically. Operator-only stacks run locally through
`packages/homelab/scripts/tofu/tofu-stack.ts` with their existing authenticated
wrappers. They are not automated by Delivery or CI. The `asuswrt` stack also
requires connectivity to both the LAN and tailnet; see
[`asuswrt/README.md`](asuswrt/README.md).

## What's Managed

### Cloudflare

`cloudflare/jerred-archives.tf` owns the private R2 archive bucket, and
`cloudflare/pinterest-archives.tf` owns its private counterpart for Pinterest
work archives. Each bucket declaration prevents destruction; each lifecycle rule
removes only abandoned multipart uploads after seven days and never expires
completed archives. The `personal-archives-r2` entry in `cloudflare-tokens`
grants object read and write on only these two buckets. Retain
these declarations while the archives exist so ordinary stack applies preserve
their storage and access policy. `jerred-archives` stays on R2. Velero's
scheduled backups are the only backup. They are written to the Backblaze
`sjerred-velero` bucket, which the `backblaze` stack declares. The R2 `homelab`
bucket that held backups taken before that move is no longer managed and is
retired out-of-band, as is the unused `glitter-discord-corpus` bucket.

`cloudflare/ts-mc-bucket.tf` and `cloudflare/sjerred-bucket.tf` own the public
download buckets behind `storage.ts-mc.net` and `files.sjer.red`. Both prevent
destruction, keep `r2.dev` disabled, and only abort abandoned multipart uploads.
They also own the two custom domains, which create those DNS records. The
provider cannot import an existing `cloudflare_r2_custom_domain` and fails to
create one that already exists. To adopt another live domain, pull the state
and add an entry with only its identifying attributes. Then run a targeted
refresh-only apply against a local-backend copy so the API fills in the rest,
and confirm a full plan shows no changes before pushing that state. Write the
pulled state to a file inside the `op run` child, because `op run` masks
secret values, including the account ID, in the child's standard output.

Each domain's `.tf` file owns its existing zone and application-specific records.
The shared `cloudflare/modules/domain-baseline` module owns DNSSEC, Fastmail MX,
DKIM, SPF, DMARC, TLS reporting, CAA, HTTPS/TLS/HSTS settings, and certificate
transparency monitoring. `baseline-migrations.tf` preserves existing state
addresses; `baseline-imports.tf` adopts previously implicit control-plane settings.

[`domain-registry.json`](../domain-registry.json) is the domain inventory and
MTA-STS policy source for both OpenTofu and Caddy. Every managed zone needs a
registry entry and a `baseline_zone_ids` binding. The Tunnel DNS coverage guard
checks the actual module CNAME and fails if either inventory or binding is missing.
Keep existing application records, Postal selectors, and `rp` routing outside
the module. Wildcard inbound MX does not authorize arbitrary subdomain senders.

Fastmail account onboarding precedes MX cutover: add each domain, preserve
existing addresses, add `root@domain`, and direct its catch-all to the existing
inbox. Keep `dmarc@sjer.red` able to receive aggregate DMARC and TLS reports.
Set `fastmailReady` only after confirming the domain in Fastmail. Until then,
the module preserves deny-all SPF and provisions no inbound MX. Prepared DKIM
selectors and policy hosts can deploy before account-side mail activation.

`mtaStsPublished` starts false while Caddy policy hosts and DNS deploy. Set it
true only after public HTTPS policy and SMTP STARTTLS verification. OpenTofu
checks the HTTPS status, exact body, and plain-text content type before creating
the discovery TXT; its revision is a hash of the shared policy. Caddy serves the
policy inline without an S3 bucket. Body-aware probes require HTTP 200 without
redirects. HSTS retains a one-day rollback window and excludes preload.

The account Bulk Redirect ruleset is also managed by OpenTofu. Its existing
`sjerred` and disabled `resume` list references retain their stable rule IDs;
the lists themselves remain external inputs. The two personal `.com` domains'
mail-policy hosts are excluded from the broad `sjerred` redirect so they can
reach the tunnel. The ruleset has `prevent_destroy` to guard replacement or
deletion while its declaration remains in the stack.

The CI Cloudflare token needs `SSL and Certificates Write` for CT alerting
and account-scoped `Mass URL Redirects Write` for the Bulk Redirect ruleset,
in addition to its existing DNS and zone settings permissions. Preserve existing
CT recipients with the explicit null `ct_alert_recipient` override; new alerts
deliver to the confirmed `root@sjer.red` inbox by default. The baseline keeps
the previously configured recipient on `better-skill-capped.com`. Cloudflare
provider 5.27.0 omits unchanged `enabled` on recipient-only updates even though
the API requires it. A recipient change triggers a create-before-destroy state
replacement: Create sends the full configuration and this provider's Delete
is a no-op, so alerts stay enabled. Recheck that contract when upgrading the
provider; do not replace the imported private-recipient resource. Registrar
auto-renew, transfer lock, privacy, and account MFA
remain operator checks because this stack does not own those settings.

Credential-free publication gate tests:

```bash
domain_test_data=$(mktemp -d /tmp/domain-baseline-tests.XXXXXX)
TF_DATA_DIR="$domain_test_data" tofu -chdir=packages/homelab/src/tofu/cloudflare init -backend=false
TF_DATA_DIR="$domain_test_data" tofu -chdir=packages/homelab/src/tofu/cloudflare test -filter=tests/domain-baseline.tftest.hcl
```

Scoped `cloudflare_api_token` resources live in the isolated
`cloudflare-tokens` state. The bootstrap token and legacy global API key remain
manual. A generated token value is exposed only as a sensitive handoff paired
with its existing 1Password rotation unit; an operator writes and proves that
handoff before revoking the superseded token.

The committed registry describes a distinct replacement for Woodpecker, the
Temporal audit worker, local `cf` tooling, cloudflare-operator, and DDNS. Each
entry records the active token ID it supersedes, readable permission names plus
their stable Cloudflare IDs, exact account or zone resources, and the existing
1Password field or JSON path. The Woodpecker and
Temporal entries deliberately split their currently shared credential. The
bootstrap identity must have API Tokens Read and Write; ordinary consumer
tokens do not receive token-administration permissions.

Set a token's `managed` field to `false` to retain its policy and handoff
metadata without creating a replacement. An omitted field defaults to `true`.
Set `s3_credential` to `true` on a token that an S3 client uses with R2. The
stack then also hands off the token id and the SHA-256 of its value to the
item's `CLOUDFLARE_R2_ACCESS_KEY_ID` and `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
fields, each as its own rotation unit.
Only Woodpecker is enabled during the initial token-stack bootstrap; the other
consumers retain their existing credentials. Enable each remaining replacement
in a separate reviewed rollout. Disabling an already managed token plans its
deletion, so inspect the exact plan before changing that field.

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
account, with a hard spend limit, a spend alert, and a model allowlist.
OpenAI subscription/Codex authentication is a separate boundary.

OpenAI rejects reads of a service account or model allowlist in an archived
project; the project itself and its spend alerts and limits stay readable.
OpenTofu refreshes every resource in state, including one a `removed` block
forgets. Before archiving a project in the dashboard, remove its service
accounts and model allowlist from desired state and apply that change;
otherwise every later plan fails until each unreadable resource is removed from
state.

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
manually created replacement. Archived keys retain their ID, name, and status
without a vault rotation target. Destruction protection keeps this metadata
managed even after the credential has been retired. To stop managing a key,
remove it from desired state and forget it with a `moved` plus `removed` block
in `migrations.tf`; destroying it is blocked.

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
non-fast-forward pushes, and requires the `ci/merge-conflict` and aggregate
`ci/woodpecker/pr/ci-complete` status checks. The code-review gate feeds the Woodpecker aggregate
status rather than being its own required check. Repository admins have a PR-only bypass for
reviewed control-plane recovery; direct pushes remain subject to the ruleset.

### SeaweedFS

All S3 buckets on the self-hosted SeaweedFS instance, managed via the AWS provider with a custom S3 endpoint.
Includes static site buckets, application storage (scout), and the tofu state backend bucket itself.

The `homelab-tofu-state` bucket has `prevent_destroy = true` since it stores state for all tofu modules.

### Tailscale

The tailnet ACL policy (`tailscale_acl`): `tagOwners`, access rules, Tailscale SSH, and policy `tests`. Moves the tailnet from implicit allow-all (every device trusted) to deny-by-default — the account owner keeps full access, non-admin humans get only the published `*.ts.net` apps, and tagged/untrusted devices are denied by default.

Delivery uses the existing Kubernetes operator's Ingress proxy with
`tailscale.com/tags: tag:delivery`. The tag owners include `tag:k8s-operator`
so the existing operator can register that proxy. Tailnet access remains
admin-only; tagged workloads receive no access to Delivery.

Apply this stack's reviewed tag policy before creating the Delivery Ingress.
The existing ACL-scoped OAuth credentials manage the policy. Delivery needs
no separate OAuth client, admin API key, node credential or encrypted state
passphrase. Browser identity comes from the operator-managed proxy; machine
API credentials remain separate.

### \*arr

Radarr/Sonarr/Prowlarr configuration imported from the live instances. Quality profiles and custom formats are owned by Recyclarr, and Radarr/Sonarr indexers by Prowlarr's application sync — neither is in this stack.

### ArgoCD

Mints the `delivery`, `delivery-platform`, read-only `delivery-observer`,
`operator-run`, read-only `workstation`, and read-only `homelab-audit` ArgoCD
account tokens and writes each to its own 1Password item. Agent workstations
read the `workstation` token from `argocd-workstation-token` through toolkit;
the Temporal homelab audit reads `argocd-homelab-audit-token`. Both accounts
have API access only and ArgoCD's built-in `role:readonly`.
ArgoCD's chart owns the account registrations and RBAC;
reconcile that chart before applying a newly registered account's token.
The stack authenticates as the `tofu-argocd` account, which may only read and
issue tokens for those accounts. The account renews its own token; its first
token comes from a cluster administrator
(`argocd account generate-token --core --account tofu-argocd` inside
`argocd-server`), written straight into the `tofu-argocd-token` item. The stack
stays operator-run until Delivery Jobs have a 1Password write path. Delivery
consumes its token separately from its API machine credentials so OpenTofu
remains the token lifecycle owner.

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

The eight established plaintext states are deliberately unchanged. Migrating
one needs its own backup, migration, restore proof, and enforcement change;
do not add a fallback or flip enforcement casually in an unrelated provider
change.

OpenTofu state is authoritative for generated credential lifecycle, while
1Password is the runtime handoff. Treat a generated secret as write-once: do
not blindly retry a failed create. Inspect the encrypted state and intended
rotation unit first, then resume deliberately. Revoke the old credential only
after its consumer proves the replacement is active.
