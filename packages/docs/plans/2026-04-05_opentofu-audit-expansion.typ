#set page(margin: (x: 2cm, y: 2cm), numbering: "1")
#set text(font: "New Computer Modern", size: 10.5pt)
#set par(justify: true, leading: 0.6em)
#set heading(numbering: "1.1")
#show link: it => text(fill: rgb("#2563eb"), it)
#show heading.where(level: 1): set text(size: 14pt)
#show heading.where(level: 2): set text(size: 12pt)

#import "@preview/gentle-clues:1.3.1": *
#import "@preview/fletcher:0.5.8": diagram, node, edge

#align(center)[
  #text(size: 20pt, weight: "bold")[OpenTofu Audit & Expansion]
  #v(0.3em)
  #text(size: 11pt, fill: gray)[Are we using OpenTofu to its fullest? What should we add?]
  #v(0.3em)
  #text(size: 10pt, fill: gray)[April 2026]
]

#v(1em)

= Current State

Four independent root modules in `packages/homelab/src/tofu/`, each with state in SeaweedFS:

#table(
  columns: (1fr, 2fr, auto),
  table.header([*Module*], [*What it manages*], [*Resources*]),
  [Cloudflare], [10 DNS zones, records, DNSSEC, SPF/DMARC/DKIM], [~300+],
  [GitHub], [12 of 17 repos (settings, merge strategy)], [12],
  [SeaweedFS], [14 S3 buckets (static sites, app storage, caches)], [17],
  [ArgoCD], [1 Buildkite service account token \+ 1Password sync], [2],
)

#info[
  Boundary: *OpenTofu = external SaaS/cloud*; *CDK8s = Kubernetes-native*. This boundary is clean and should be preserved.
]

= Phase 1: Fix Existing Gaps #text(size: 9pt, fill: gray)[(low risk, no new providers)]

== 1a. GitHub: Add missing repos \+ `for_each` refactor

*5 repos exist on GitHub but aren't tracked:* `cooklang-for-obsidian`, `golink`, `obsidian-releases`, `figma-use`, plus verify with `gh repo list`.

All 12 current repo blocks are copy-paste with only `name`, `description`, `homepage_url` varying. Refactor to:

```
locals { repos = { "monorepo" = { description = "...", ... }, ... } }
resource "github_repository" "repo" { for_each = local.repos ... }
```

This cuts ~180 lines to ~40 and makes adding repos trivial.

== 1b. GitHub: Add `github_repository_ruleset`

Branch protection was removed because `github_branch_protection` hung on GraphQL. The newer `github_repository_ruleset` resource uses the REST API --- different code path, no GraphQL hang. Codify `main` branch protection rules.

== 1c. SeaweedFS: Replace lifecycle hack

Lines 56--107 of `buckets.tf` use `terraform_data` \+ `local-exec` calling `aws s3api`. This is non-idempotent and requires the AWS CLI in the container. Replace with `aws_s3_bucket_lifecycle_configuration` resources.

#warning[
  *Risk:* SeaweedFS may not support this S3 API through the provider. Test with `tofu plan` first. If unsupported, keep the hack with a comment.
]

== 1d. Cleanup: Remove unused variable

`variables.tf` in the GitHub module declares `cloudflare_account_id` which is never referenced.

= Phase 2: New Providers #text(size: 9pt, fill: gray)[(medium risk, new secrets/state)]

Each gets its own directory following the established pattern.

#table(
  columns: (auto, 1fr, auto, auto),
  table.header([*Provider*], [*Key Resources*], [*New Secrets*], [*Value*]),
  [`tailscale/tailscale`],
  [ACL policy, DNS preferences, nameservers],
  [`TAILSCALE_API_KEY`\ `TAILSCALE_TAILNET`],
  [*High*],

  [`buildkite/buildkite`],
  [Pipeline definitions, agent tokens, org settings],
  [`BUILDKITE_API_TOKEN`\ `BUILDKITE_ORG_SLUG`],
  [*Medium*],

  [`pagerduty/pagerduty`],
  [Services, escalation policies, integrations],
  [`PAGERDUTY_TOKEN`],
  [*Low*],
)

#tip[
  *Tailscale is highest priority* --- it's the networking backbone. ACL policy drift is invisible until something breaks.
]

=== Why defer PagerDuty?

Single-person homelab. PagerDuty config is small and stable. Not worth the secret management overhead unless it's actively drifting.

= Phase 3: CI Updates

*File:* `.dagger/src/release.ts` (lines 76--169)

`tofuApplyHelper`/`tofuPlanHelper` take hardcoded optional params for each provider's secrets. Adding 4 more providers would make the signature unwieldy.

*Change:* Add `extraEnvSecrets?: Record<string, Secret>` so each stack declares which secrets it needs without growing the function signature.

= Priority Order

#table(
  columns: (auto, 2fr, auto, auto),
  table.header([*\#*], [*Task*], [*Effort*], [*Value*]),
  [1], [GitHub `for_each` refactor \+ missing repos], [Medium], [Completeness],
  [2], [GitHub `repository_ruleset`], [Small], [Branch protection as code],
  [3], [SeaweedFS lifecycle fix], [Small], [Correctness],
  [4], [Tailscale provider], [Medium], [Infra backbone],
  [5], [Dagger CI secret generalization], [Small], [Maintainability],
  [6], [Buildkite provider], [Medium], [CI reproducibility],
  [7], [PagerDuty provider], [Small], [Low priority],
)

= Verification

For each change:
+ `op run --env-file=.env -- tofu -chdir={module} plan` --- no unexpected diff
+ For imports: `tofu import` then `tofu plan` shows zero changes
+ For new providers: `tofu init` succeeds, `tofu plan` shows expected creates
+ Dagger CI: `bun run typecheck` in `.dagger/` after modifying `release.ts`
