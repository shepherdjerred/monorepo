# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/2026-02-22_monorepo-structure.md) - Package discovery, repo layout, and verification commands
- [Monarch](architecture/2026-02-23_monarch.md) - Transaction categorization pipeline with tiered classification
- [Release/Push/Deploy Inventory](architecture/2026-04-04_release-push-inventory.md) - External publish targets from the CI catalog

## Patterns

- [ESLint Configuration](patterns/2026-02-22_eslint-config.md) - Shared ESLint setup and per-package overrides

## Decisions

- [Dagger --source . vs Plain Steps](decisions/2026-04-03_dagger-source-vs-plain-steps.md) - Tradeoff: full-repo copy cost in Dagger vs isolation loss in plain Buildkite steps
- [CI Security Audit](decisions/2026-04-04_ci-security-audit.md) - Buildkite + Dagger security audit for external contributor safety
- [Unified Versioning Strategy](decisions/2026-04-04_unified-versioning-strategy.md) - Restored Era 1 versioning with `2.0.0-BUILD` format
- [Env Var Naming Convention](decisions/2026-03-27_env-var-naming-convention.md) - Canonical env var names across 1Password, K8s, CI, and shells
- [Kueue for Buildkite Resource Management](decisions/2026-03-18_kueue-buildkite-resource-management.md) - Why Kueue replaced ResourceQuota for CI job admission
- [Dagger Disk Write Amplification](decisions/2026-02-23_dagger-disk-write-amplification.md) - Historical Dagger engine I/O incident and mitigation notes
- [1Password Deduplication](decisions/2026-03-08_1password-deduplication.md) - Deduplicating 1Password secret references
- [Renovate HA Manager Disabled](decisions/2026-04-05_renovate-homeassistant-manager-disabled.md) - Disabled homeassistant-manifest manager for non-HA manifests
- [CI Build Scoping Fixes](decisions/2026-04-26_ci-build-scoping-fixes.md) - Three bugs causing every main build to rebuild all 25 packages; fixed baseline lookup and Renovate fast-track

## Plans

- [Bedrock Waker](plans/2026-03-01_bedrock-waker.md) - UDP proxy to wake sleeping Minecraft Bedrock servers
- [CI Reporting & Artifact Collection](plans/2026-04-04_ci-reporting-artifacts.md) - Structured CI reports, coverage, and artifacts
- [CI Security Remediation](plans/2026-04-04_ci-security-remediation-plan.md) - Defense-in-depth work before enabling external contributor CI
- [Accelerated CI for Release-Please](plans/2026-04-05_accelerated-ci-release-please.md) - Fast path for automated version-bump and release PRs
- [CI Quality Hardening](plans/2026-04-05_ci-quality-hardening.md) - Make Trivy, Semgrep, and Knip hard failures
- [OpenTofu Audit & Expansion](plans/2026-04-05_opentofu-audit-expansion.md) - Existing tofu module gaps and candidate providers
- [Scout Branded Types](plans/2026-04-05_scout-branded-types.md) - Add missing branded domain IDs to scout-for-lol
- [Move Scripts to Packages](plans/2026-04-07_move-scripts-to-packages.md) - Relocate root scripts into package-owned paths
- [Dagger CI Infrastructure Fixes](plans/2026-04-21_dagger-ci-infra-fixes.md) - Punch list for ciAllHelper and Dagger infra bugs
- [Temporal Tailscale Exposure](plans/2026-04-21_temporal-tailscale-exposure.md) - Expose Temporal gRPC over Tailscale without port-forwarding
- [Homelab Ops Hardening Backlog](plans/2026-04-25_homelab-ops-hardening-backlog.md) - Active follow-ups from the archived homelab ops audit
- [Renovate Blocked Majors](plans/2026-04-25_renovate-blocked-majors.md) - Dedicated-session dependency upgrades and deploy promotions
- [Shared Glitter-Context Package](plans/2026-04-25_shared-glitter-context-package.md) - De-duplicate style cards and lore across Birmel and Scout
- [Tasks for Obsidian iOS Target Wiring](plans/2026-04-25_tasks-for-obsidian-ios-target-wiring.md) - Finish native iOS target wiring after the completed audit
- [PR Review and Summary Bot](plans/2026-04-25_pr-review-and-summary-bot.md) - GH webhook → Temporal → claude -p + GitHub MCP for auto code-review and PR summaries
- [Polyrepo → Monorepo Link Audit](plans/2026-04-25_polyrepo-link-audit.md) - Rewrite all stale polyrepo URLs to monorepo + add lychee CI link-check gate

## Guides

- [Monarch Accuracy Test](guides/2026-02-22_monarch-accuracy-test.md) - Monarch transaction categorization accuracy testing
- [Dotfiles Update](guides/2026-03-08_dotfiles-update.md) - Dotfiles update script and known issues
- [Local Quality Check](guides/2026-04-03_local-quality-check.md) - Full monorepo verification commands
- [Helm Escaping Pipeline](guides/2026-04-04_helm-escaping-pipeline.md) - Template escaping across TypeScript, cdk8s, Helm, and consumers
- [Homelab Audit Runbook](guides/2026-04-04_homelab-audit-runbook.md) - Repeatable comprehensive cluster health audit
- [Is My Commit Deployed?](guides/2026-04-06_is-commit-deployed.md) - Trace a commit through CI, images, charts, and ArgoCD
- [NVMe Wear Attribution](guides/2026-04-21_nvme-wear-attribution.md) - Byte-level accounting of NVMe write sources
- [Type-safe Home Assistant Client](guides/2026-04-21_type-safe-home-assistant-client.md) - `ha-codegen`, generated schema, and Temporal usage
- [Birmel Remediation Follow-ups](guides/2026-04-25_birmel-remediation-followups.md) - Post-deploy checks and deferred cleanup from Birmel remediation
- [Homelab Health Audit](guides/2026-04-25_homelab-health-audit.md) - Current cluster health audit snapshot
- [Minecraft Server Ops](guides/2026-04-25_minecraft-server-ops.md) - Operational reference for deployed modded Minecraft servers
- [Home Assistant Kumo Troubleshooting](guides/2026-04-26_home-assistant-kumo-troubleshooting.md) - Diagnosing `device_authentication_error`, pykumo/v3 cache drift, and executor-pool starvation

## Archive

Historical docs preserved for reference. These are no longer actively maintained.

- [`archive/bazel/`](archive/bazel/) - 12 docs from the Bazel era
- [`archive/changelogs/`](archive/changelogs/) - 1 historical changelog
- [`archive/completed/`](archive/completed/) - 2 completed plans and audits
- [`archive/dagger-migration/`](archive/dagger-migration/) - 18 Dagger migration plans and audits
- [`archive/homelab-audits/`](archive/homelab-audits/) - 6 superseded homelab health audit snapshots
- [`archive/on-hold/`](archive/on-hold/) - 4 on-hold Sentinel architecture and implementation docs
- [`archive/scout-followups/`](archive/scout-followups/) - 1 time-boxed Scout follow-up checklist
- [`archive/stale/`](archive/stale/) - 7 stale operational snapshots and superseded plans
- [`archive/superseded/`](archive/superseded/) - 5 older superseded plans
