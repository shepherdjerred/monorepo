# OpenTofu Audit & Expansion Plan

## Status

Partial. GitHub ruleset work has started, but module cleanup and new providers remain open.

## Context

Audit of current OpenTofu usage to identify gaps, missing resources, and new providers worth adding. The homelab has 4 tofu modules (cloudflare, github, seaweedfs, argocd) but several external services are managed manually.

---

## Phase 1: Fix Existing Module Gaps (low risk, no new providers)

### 1a. GitHub: Add 5 missing repos + `for_each` refactor + rulesets

**File:** `packages/homelab/src/tofu/github/repos.tf`

17 non-archived repos exist on GitHub; 12 are managed. Missing:

- `cooklang-for-obsidian`
- `golink`
- `obsidian-releases`
- `figma-use`
- (verify with `gh repo list --no-archived` for any others)

**Changes:**

1. Refactor 12 copy-paste `github_repository` blocks into a single resource with `for_each` over a `locals` map (all repos share identical settings except `name`, `description`, `homepage_url`, `has_issues`)
2. Add the 5 missing repos to the map
3. `tofu import` existing repos into the new addresses
4. Add `github_repository_ruleset` for `main` branch protection (replaces the removed `github_branch_protection` -- rulesets use a different REST API, not the GraphQL endpoint that hung)

### 1b. SeaweedFS: Replace `terraform_data` lifecycle hack

**File:** `packages/homelab/src/tofu/seaweedfs/buckets.tf` (lines 56-107)

The `terraform_data` + `local-exec` provisioner calling `aws s3api put-bucket-lifecycle-configuration` is non-idempotent and requires the AWS CLI in the container. Replace with `aws_s3_bucket_lifecycle_configuration` resources.

**Risk:** SeaweedFS may not support this S3 API through the Terraform provider. Test with `tofu plan` first. If unsupported, keep the hack but add a comment explaining why.

### 1c. GitHub: Remove unused `cloudflare_account_id` variable

**File:** `packages/homelab/src/tofu/github/variables.tf` -- has a `cloudflare_account_id` variable that isn't used in any GitHub resources.

---

## Phase 2: New Providers (medium risk, new secrets/state)

Each new provider gets its own directory following the existing pattern: `packages/homelab/src/tofu/{name}/` with `backend.tf`, `providers.tf`, `variables.tf`, and resource files.

### 2a. Tailscale (`tailscale/tailscale`) -- HIGH value

Tailscale is the networking backbone (state backend endpoints, service mesh, ingress). ACL policy is currently manual in the admin console.

**Resources:**

- `tailscale_acl` -- ACL policy as code (most critical)
- `tailscale_dns_preferences` -- MagicDNS settings
- `tailscale_dns_nameservers` -- custom nameservers

**New secrets:** `TAILSCALE_API_KEY`, `TAILSCALE_TAILNET`

### 2b. Buildkite (`buildkite/buildkite`) -- MEDIUM value

**Resources:**

- `buildkite_pipeline` -- pipeline definitions
- `buildkite_agent_token` -- agent tokens (store in 1Password like ArgoCD)

**New secrets:** `BUILDKITE_API_TOKEN`, `BUILDKITE_ORGANIZATION_SLUG`

### 2c. PagerDuty (`pagerduty/pagerduty`) -- LOW value (config is stable/simple)

Defer unless actively causing drift. Single-person homelab means PagerDuty config rarely changes.

---

## Phase 3: Dagger CI Updates

**File:** `.dagger/src/release.ts` (lines 76-169)

The `tofuApplyHelper`/`tofuPlanHelper` functions currently take hardcoded optional params for Cloudflare/GitHub/ArgoCD secrets. Adding Tailscale, Buildkite would make the signature unwieldy.

**Change:** Add an `extraEnvSecrets?: Record<string, Secret>` parameter so each stack declares which secrets it needs without growing the function signature.

---

## Phase 4: Documentation

**File:** `packages/homelab/src/tofu/README.md` -- update structure diagram, "What's Managed" section, and prerequisite env vars for new modules.

---

## Priority Order

| #   | Task                                       | Effort | Value                     |
| --- | ------------------------------------------ | ------ | ------------------------- |
| 1   | GitHub `for_each` refactor + missing repos | Medium | Completeness              |
| 2   | GitHub `repository_ruleset`                | Small  | Branch protection as code |
| 3   | SeaweedFS lifecycle fix                    | Small  | Correctness               |
| 4   | Tailscale provider                         | Medium | High (infra backbone)     |
| 5   | Dagger CI secret generalization            | Small  | Maintainability           |
| 6   | Buildkite provider                         | Medium | CI reproducibility        |
| 7   | PagerDuty provider                         | Small  | Low priority              |

---

## Verification

For each change:

1. `op run --env-file=.env -- tofu -chdir={module} plan` -- verify no unexpected changes
2. For imports: `tofu import` existing resources, then `tofu plan` shows no diff
3. For new providers: `tofu init` succeeds, `tofu plan` shows expected creates
4. Dagger CI: run `bun run typecheck` in `.dagger/` after modifying `release.ts`
