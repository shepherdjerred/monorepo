# OpenTofu Infrastructure

Manages external cloud resources (Cloudflare DNS, GitHub repo settings, SeaweedFS S3 buckets) with [OpenTofu](https://opentofu.org/).

## Structure

```text
tofu/
├── cloudflare/          # DNS zones, bot management, email security
│   ├── backend.tf       # S3 state backend (SeaweedFS)
│   ├── providers.tf     # Cloudflare provider ~> 4.0
│   ├── variables.tf     # Input variables
│   └── *.tf             # One file per domain
├── github/              # Repository configuration
│   ├── backend.tf       # S3 state backend (SeaweedFS)
│   ├── providers.tf     # GitHub provider ~> 6.0
│   ├── variables.tf     # Input variables
│   └── repos.tf         # Repository definitions
└── seaweedfs/           # SeaweedFS S3 bucket management
    ├── backend.tf       # S3 state backend (SeaweedFS)
    ├── providers.tf     # AWS provider ~> 5.0 (custom S3 endpoint)
    ├── variables.tf     # Input variables
    └── buckets.tf       # S3 bucket definitions
```

Each subdirectory is an independent root module with its own state.

## Prerequisites

- OpenTofu >= 1.6.0 (`mise` manages this automatically)
- Environment variables:
  - `CLOUDFLARE_API_TOKEN` - Cloudflare API token
  - `GITHUB_TOKEN` - GitHub personal access token
  - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` - S3 credentials for SeaweedFS state backend
  - `TF_VAR_cloudflare_account_id` - Cloudflare account ID

## Usage

```bash
# Initialize providers and backend
tofu -chdir=cloudflare init
tofu -chdir=github init
tofu -chdir=seaweedfs init

# Preview changes
tofu -chdir=cloudflare plan
tofu -chdir=github plan
tofu -chdir=seaweedfs plan

# Apply changes
tofu -chdir=cloudflare apply
tofu -chdir=github apply
tofu -chdir=seaweedfs apply
```

## CI/CD

The Dagger pipeline (`../../.dagger/src/homelab/tofu.ts`) runs `tofu plan -detailed-exitcode` on all modules in parallel and
reports drift. It does **not** auto-apply -- apply is a manual step.

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

The `homelab` repository settings: public visibility, squash-only merges, auto-delete branches on merge.

### SeaweedFS

All S3 buckets on the self-hosted SeaweedFS instance, managed via the AWS provider with a custom S3 endpoint.
Includes static site buckets, application storage (scout), build cache (sccache), and the tofu state backend
bucket itself.

The `homelab-tofu-state` bucket has `prevent_destroy = true` since it stores state for all tofu modules.
The sccache bucket's 30-day expiration lifecycle is managed separately by
`scripts/seaweedfs/setup-sccache-bucket.sh`.

## Adding a New Domain

1. Create `cloudflare/{domain-with-dashes}.tf`
2. Copy the pattern from an existing file (e.g. `scout-for-lol-com.tf`)
3. Update the zone name, resource names, and DMARC `rua` email
4. Run `tofu -chdir=cloudflare plan` to verify, then `apply`

To import existing Cloudflare records into state, use [`cf-terraforming`](https://github.com/cloudflare/cf-terraforming).

## State Backend

State is stored in a self-hosted SeaweedFS S3 bucket (`homelab-tofu-state`), split by module:

- `cloudflare/terraform.tfstate`
- `github/terraform.tfstate`
- `seaweedfs/terraform.tfstate`
