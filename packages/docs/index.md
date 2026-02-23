# Monorepo Documentation

AI-maintained knowledge base for the monorepo.

## Architecture

- [Monorepo Structure](architecture/monorepo-structure.md) - Package layout, workspaces, and conventions
- [CI Pipeline](architecture/ci-pipeline.md) - Dagger-based CI/CD overview
- [Sentinel](architecture/sentinel.md) - Autonomous agent system architecture

## Patterns

- [ESLint Configuration](patterns/eslint-config.md) - Shared ESLint setup and per-package overrides

## Decisions

_No decision records yet._

## Plans

- [Buildkite Dynamic Pipeline](plans/buildkite.md) - Split Dagger CI into granular Buildkite steps
- [ArgoCD Token Management](plans/argocd-token-management.md) - Automate ArgoCD token via OpenTofu + 1Password
- [Sentinel Implementation](plans/sentinel-implementation.md) - Autonomous agent system build plan with phased rollout
- [Autonomous Agent System Research](plans/autonomous-agent-system.md) - Architecture research: memory, permissions, queue design

## Guides

- [Sentinel Deployment](guides/sentinel-deployment.md) - Manual steps to deploy sentinel to the cluster
