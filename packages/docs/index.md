# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/2026-02-22_monorepo-structure.md) - Package layout, workspaces, and conventions
- [Sentinel](architecture/2026-02-22_sentinel.md) - Autonomous agent system architecture
- [Monarch](architecture/2026-02-23_monarch.md) - Transaction categorization pipeline with tiered classification
- [Release/Push/Deploy Inventory](architecture/2026-04-04_release-push-inventory.md) - Complete inventory of all external publish targets (Docker, Helm, npm, S3, GitHub, Tofu, ArgoCD)

## Patterns

- [ESLint Configuration](patterns/2026-02-22_eslint-config.md) - Shared ESLint setup and per-package overrides

## Decisions

- [Dagger CI Three-Era Audit](decisions/2026-03-29_dagger-ci-three-era-audit.md) - Comprehensive comparison of Dagger CI across pre-monorepo, pre-Bazel, and current eras
- [Dagger Audit: Current vs Plans](decisions/2026-04-02_dagger-audit-current-vs-plans.md) - Full audit of Dagger CI: 27 findings status, lost features, implementation plan
- [Dagger --source . vs Plain Steps](decisions/2026-04-03_dagger-source-vs-plain-steps.md) - Tradeoff: full-repo copy cost in Dagger vs isolation loss in plain Buildkite steps
- [CI Reporting & Artifact Collection](decisions/2026-04-04_ci-reporting-artifacts.md) - Audit of what CI collects today vs what's missing; phased plan for test analytics, coverage, lint annotations
- [Unified Versioning Strategy](decisions/2026-04-04_unified-versioning-strategy.md) - Restored Era 1 versioning with `2.0.0-BUILD` format; migration plan
- [Dagger Full Audit](decisions/2026-03-29_dagger-full-audit.md) - Line-by-line audit of all Dagger code; 27 findings across 4 tiers
- [Env Var Naming Convention](decisions/2026-03-27_env-var-naming-convention.md) - Canonical env var names, 1Password field = K8s key = env var convention, banned names linter
- [Kueue for Buildkite Resource Management](decisions/2026-03-18_kueue-buildkite-resource-management.md) - Why ResourceQuota caused etcd meltdowns and how Kueue replaces it with Job suspension
- [Dagger Disk Write Amplification](decisions/2026-02-23_dagger-disk-write-amplification.md) - Identified disk I/O issue from full-monorepo source copies
- [1Password Deduplication](decisions/2026-03-08_1password-deduplication.md) - Deduplicating 1Password secret references
- [Renovate HA Manager Disabled](decisions/2026-04-05_renovate-homeassistant-manager-disabled.md) - Disabled homeassistant-manifest manager (no HA integrations); re-enable if adding HA custom components

## Plans

- [CI Complete Fix Plan](plans/2026-04-03_ci-complete-fix-plan.md) - Complete fix plan with 5-layer DAG (52 individual tasks)
- [CI Scripts ESLint](plans/2026-04-03_ci-scripts-eslint.md) - ESLint setup for `scripts/ci/src/`
- [Dagger Migration](plans/2026-03-19_dagger-migration.md) - Replace Bazel with Dagger for CI: root cause analysis, architecture, migration phases
- [ZFS Orphan Cleanup](plans/2026-03-26_zfs-orphan-cleanup.md) - ZFS orphaned volume cleanup (in progress)
- [ArgoCD Token Management](plans/2026-02-22_argocd-token-management.md) - Automate ArgoCD token via OpenTofu + 1Password (partial, manual steps remain)
- [Sentinel Implementation](plans/2026-02-22_sentinel-implementation.md) - Autonomous agent system build plan with phased rollout
- [Autonomous Agent System Research](plans/2026-02-22_autonomous-agent-system.md) - Architecture research: memory, permissions, queue design
- [Tasks for Obsidian iOS Audit](plans/2026-02-26_tasks-for-obsidian-ios-audit.md) - iOS app compliance and review (in progress)
- [Bedrock Waker](plans/2026-03-01_bedrock-waker.md) - Minecraft Bedrock server wake-on-LAN
- [Local CI/Release CLI](plans/2026-03-18_local-ci-release-cli.md) - Run deploy/release workflows locally without Buildkite
- [Scout User Outreach](plans/2026-03-27_scout-user-outreach.md) - User engagement plan for Discord bot
- [PV Expansion](plans/2026-04-04_pv-expansion.md) - Expand PVs near capacity

## Guides

- [Helm Escaping Pipeline](guides/2026-04-04_helm-escaping-pipeline.md) - How template-bearing content survives the multi-engine rendering pipeline
- [Local Quality Check](guides/2026-04-03_local-quality-check.md) - Full monorepo verification: all linters, tests, builds, and quality gates
- [Homelab Audit Runbook](guides/2026-04-04_homelab-audit-runbook.md) - Repeatable procedure for comprehensive cluster health audit
- [Homelab Health Audit (2026-04-05)](guides/2026-04-05_homelab-health-audit.md) - 1Password Connect corrupted, 18 degraded apps, NVMe1 thermal
- [Homelab Health Audit (2026-03-28)](guides/2026-03-28_homelab-health-audit.md) - Point-in-time audit result: 313 days uptime, critical issues
- [Network Policy Gaps](guides/2026-03-15_network-policy-gaps.md) - Kubernetes network policy analysis
- [Minecraft Modpack Recommendations](guides/2026-03-27_minecraft-modpack-recommendations.md) - Modpack research for non-combat playstyles
- [Monthly Changelog: March 2026](guides/2026-03-19_monthly-changelog-march.md) - Summary of major changes Feb 19 – Mar 19, 2026
- [Local CI/Release CLI](guides/2026-03-18_local-ci-cli.md) - Run deploy/release workflows locally without Buildkite
- [Dotfiles Update](guides/2026-03-08_dotfiles-update.md) - Dotfiles configuration and update guide
- [Monarch Accuracy Test](guides/2026-02-22_monarch-accuracy-test.md) - Monarch transaction categorization accuracy testing
- [Sentinel Deployment](guides/2026-02-22_sentinel-deployment.md) - Manual steps to deploy sentinel to the cluster

## Archive

Historical docs preserved for reference. These are no longer actively maintained.

- [`archive/bazel/`](archive/bazel/) - 14 docs from the Bazel era (Bazel removed from monorepo)
- [`archive/superseded/`](archive/superseded/) - 12 plans superseded by the [CI Complete Fix Plan](plans/2026-04-03_ci-complete-fix-plan.md)
