# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/2026-02-22_monorepo-structure.md) - Package layout, workspaces, and conventions
- [CI Pipeline](architecture/2026-02-22_ci-pipeline.md) - Bazel-based CI/CD overview
- [Sentinel](architecture/2026-02-22_sentinel.md) - Autonomous agent system architecture
- [Monarch](architecture/2026-02-23_monarch.md) - Transaction categorization pipeline with tiered classification
- [Package Integration Audit](architecture/2026-02-27_package-integration-audit.md) - Integration status of new packages (sentinel, tasks-for-obsidian, tasknotes-server)

## Patterns

- [ESLint Configuration](patterns/2026-02-22_eslint-config.md) - Shared ESLint setup and per-package overrides

## Decisions

- [rules_bun2 Architecture](decisions/2026-03-20_rules-bun2-architecture.md) - Monolithic bun install for Bazel: 6 approaches tried, what worked, what failed, and why
- [Kueue for Buildkite Resource Management](decisions/2026-03-18_kueue-buildkite-resource-management.md) - Why ResourceQuota caused etcd meltdowns and how Kueue replaces it with Job suspension
- [1Password Deduplication](decisions/2026-03-08_1password-deduplication.md) - Deduplicating 1Password secret references

## Plans

- [Bazel Bun-Native Phase 3](plans/2026-03-11_bazel-bun-native-phase3.md) - Drop rules_js, fully bun-native Bazel (~95% complete)
- [rules_bun v2](plans/2026-03-17_rules-bun-v2-link-first-materialization.md) - Link-first prepared trees plus first-class Vite/Astro support
- [rules_bun v2 Hermetic Framework Rules](plans/2026-03-18_rules-bun-v2-hermetic-framework-rules.md) - Complete hermetic, remote-cacheable Bun/Vite/Astro migration plan
- [rules_bun v2 Implementation Status](plans/2026-03-19_rules-bun-v2-implementation-status.md) - Progress tracker: infrastructure done, Astro works, Vite blocked on realpath
- [Dagger Migration](plans/2026-03-19_dagger-migration.md) - Replace Bazel with Dagger for CI: root cause analysis, architecture, migration phases
- [Remove Node/npm/pnpm Dependencies](plans/2026-03-10_remove-node-npm-pnpm-deps.md) - Bun-only monorepo migration (~95% complete)
- [Bedrock Waker](plans/2026-03-01_bedrock-waker.md) - Minecraft Bedrock server wake-on-LAN
- [Tasks for Obsidian iOS Audit](plans/2026-02-26_tasks-for-obsidian-ios-audit.md) - iOS app compliance and review
- [Buildkite Dynamic Pipeline](plans/2026-02-22_buildkite.md) - Bazel + Buildkite CI pipeline design (implemented in Python)
- [ArgoCD Token Management](plans/2026-02-22_argocd-token-management.md) - Automate ArgoCD token via OpenTofu + 1Password
- [Sentinel Implementation](plans/2026-02-22_sentinel-implementation.md) - Autonomous agent system build plan with phased rollout
- [Autonomous Agent System Research](plans/2026-02-22_autonomous-agent-system.md) - Architecture research: memory, permissions, queue design

## Guides

- [Monthly Changelog: March 2026](guides/2026-03-19_monthly-changelog-march.md) - Summary of major changes Feb 19 – Mar 19, 2026
- [Local CI/Release CLI](guides/2026-03-18_local-ci-cli.md) - Run deploy/release workflows locally without Buildkite
- [Dotfiles Update](guides/2026-03-08_dotfiles-update.md) - Dotfiles configuration and update guide
- [Monarch Accuracy Test](guides/2026-02-22_monarch-accuracy-test.md) - Monarch transaction categorization accuracy testing
- [Bazel Profiling Automation](guides/2026-03-19_bazel-profiling-automation.md) - Bazel build profiling and analysis
- [Sentinel Deployment](guides/2026-02-22_sentinel-deployment.md) - Manual steps to deploy sentinel to the cluster

## Other

- [Network Policy Gaps](2026-03-15_network-policy-gaps.md) - Kubernetes network policy analysis
