# CI Pipeline

Bazel-based CI running on Buildkite with Python orchestration scripts.

## Running CI

```bash
bazel build //...
bazel test //...
```

## Pipeline Stages

The Buildkite pipeline (`.buildkite/pipeline.yml`) runs these stages:

### 1. Build & Test

- `bazel build //...` — builds all targets (TS packages, Rust binaries, container images)
- `bazel test //...` — runs all test targets
- Stamped image builds for container artifacts

### 2. Release

- **release-please** manages release PRs and GitHub releases
- Triggered on main branch merges
- Generates changelogs and version bumps

### 3. Publish

- GHCR image push via `oci_push` rules (birmel, sentinel, tasknotes-server, starlight-karma-bot)
- Conditional NPM publish for library packages
- Python scripts in `scripts/ci/src/ci/` orchestrate publish logic

### 4. Deploy

- Static sites built (Astro, LaTeX) and deployed to SeaweedFS S3 via `aws s3 sync`
- Clauderon binary cross-compilation and GitHub release asset upload (conditional on release-please)

### 5. Homelab Release

- Builds 4 infra container images (HA, dependency-summary, dns-audit, caddy-s3proxy) via Docker
- Packages 23+ Helm charts and pushes to ChartMuseum
- OpenTofu apply for 4 stacks (argocd, cloudflare, github, seaweedfs)
- ArgoCD sync with health polling

### 6. Version Commit-Back

- Digest-pinned container versions written to `packages/homelab/src/cdk8s/src/versions.ts`
- Committed back to the repository after successful publish

## Key Infrastructure

- **Bazel toolchain**: Custom Bun toolchain in `tools/bun/` (Bun as Node.js drop-in)
- **Container images**: `bun_service_image` macro in `tools/oci/bun_service_image.bzl`
- **Python CI scripts**: `scripts/ci/src/ci/` using uv for dependency management
- **Shell scripts**: `.buildkite/scripts/` for pipeline step entry points
- **Bazelisk**: v1.25.0 installed in CI, version pinned via `.bazelversion`

## Quality Checks

- **Quality ratchet**: Tracks suppression counts in `.quality-baseline.json`
- **Compliance check**: Verifies eslint config + lint/typecheck scripts per package
- **ESLint**: Per-package with shared config from `packages/eslint-config/`
