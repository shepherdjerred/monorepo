# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/2026-02-22_monorepo-structure.md) - Package layout, workspaces, and conventions
- [CI Pipeline](architecture/2026-02-22_ci-pipeline.md) - Bazel-based CI/CD overview
- [Sentinel](architecture/2026-02-22_sentinel.md) - Autonomous agent system architecture
- [Monarch](architecture/2026-02-23_monarch.md) - Transaction categorization pipeline with tiered classification
- [Package Integration Audit](architecture/2026-02-27_package-integration-audit.md) - Integration status of new packages (sentinel, tasks-for-obsidian, tasknotes-server)
- [Dirty Worktree State](architecture/2026-03-08_dirty-worktree-state.md) - Uncommitted WIP rules_bun migration breaking local Bazel builds

## Patterns

- [ESLint Configuration](patterns/2026-02-22_eslint-config.md) - Shared ESLint setup and per-package overrides

## Decisions

_No decision records yet._

## Plans

- [Bazel Bun-Native Phase 3](plans/2026-03-11_bazel-bun-native-phase3.md) - Drop rules_js, fully bun-native Bazel (~95% complete)
- [rules_bun v2](plans/2026-03-17_rules-bun-v2-link-first-materialization.md) - Link-first prepared trees plus first-class Vite/Astro support
- [rules_bun v2 Hermetic Framework Rules](plans/2026-03-18_rules-bun-v2-hermetic-framework-rules.md) - Complete hermetic, remote-cacheable Bun/Vite/Astro migration plan
- [Buildkite Dynamic Pipeline](plans/2026-02-22_buildkite.md) - Bazel + Buildkite CI pipeline design
- [ArgoCD Token Management](plans/2026-02-22_argocd-token-management.md) - Automate ArgoCD token via OpenTofu + 1Password
- [Sentinel Implementation](plans/2026-02-22_sentinel-implementation.md) - Autonomous agent system build plan with phased rollout
- [Autonomous Agent System Research](plans/2026-02-22_autonomous-agent-system.md) - Architecture research: memory, permissions, queue design

## Guides

- [Sentinel Deployment](guides/2026-02-22_sentinel-deployment.md) - Manual steps to deploy sentinel to the cluster
