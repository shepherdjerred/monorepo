# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/monorepo-structure.md) - Package layout, workspaces, and conventions
- [CI Pipeline](architecture/ci-pipeline.md) - Bazel-based CI/CD overview
- [Sentinel](architecture/sentinel.md) - Autonomous agent system architecture
- [Monarch](architecture/monarch.md) - Transaction categorization pipeline with tiered classification
- [Package Integration Audit](architecture/package-integration-audit.md) - Integration status of new packages (sentinel, tasks-for-obsidian, tasknotes-server)
- [Dirty Worktree State](architecture/dirty-worktree-state.md) - Uncommitted WIP rules_bun migration breaking local Bazel builds

## Patterns

- [ESLint Configuration](patterns/eslint-config.md) - Shared ESLint setup and per-package overrides

## Decisions

_No decision records yet._

## Plans

- [Bazel Bun-Native Phase 3](plans/bazel-bun-native-phase3.md) - Drop rules_js, fully bun-native Bazel (~95% complete)
- [Buildkite Dynamic Pipeline](plans/buildkite.md) - Bazel + Buildkite CI pipeline design
- [ArgoCD Token Management](plans/argocd-token-management.md) - Automate ArgoCD token via OpenTofu + 1Password
- [Sentinel Implementation](plans/sentinel-implementation.md) - Autonomous agent system build plan with phased rollout
- [Autonomous Agent System Research](plans/autonomous-agent-system.md) - Architecture research: memory, permissions, queue design

## Guides

- [Sentinel Deployment](guides/sentinel-deployment.md) - Manual steps to deploy sentinel to the cluster
