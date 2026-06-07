/**
 * Shared constants used across Dagger module files.
 *
 * All image tags, cache volume names, and directory exclusion patterns
 * live here to avoid duplication and ensure consistency.
 */

// ---------------------------------------------------------------------------
// Container images
// ---------------------------------------------------------------------------

// renovate: datasource=docker depName=oven/bun
export const BUN_IMAGE =
  "oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4";
// renovate: datasource=docker depName=rust
export const RUST_IMAGE =
  "rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1";
// renovate: datasource=docker depName=golang
export const GO_IMAGE =
  "golang:1.26.3-bookworm@sha256:386d475a660466863d9f8c766fec64d7fdad3edac2c6a05020c09534d71edb4b";
// renovate: datasource=docker depName=mcr.microsoft.com/playwright
export const PLAYWRIGHT_IMAGE =
  "mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948";
// renovate: datasource=docker depName=ghcr.io/realm/swiftlint
export const SWIFTLINT_IMAGE =
  "ghcr.io/realm/swiftlint:0.63.2@sha256:8db376ff8a26e56fa506b56b8c70ea9c5583dc52d5746ce23b6c2c4d4ee00e31";
// renovate: datasource=docker depName=alpine
export const ALPINE_IMAGE =
  "alpine:3.23@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11";
// renovate: datasource=docker registryUrl=https://ghcr.io depName=opentofu/opentofu
export const TOFU_IMAGE =
  "ghcr.io/opentofu/opentofu:1.11.7@sha256:6166f12d09520dbbb431a13951973c5b1046c01f801fa8c7b73e89511a0fff34";
// renovate: datasource=docker depName=maven
export const MAVEN_IMAGE =
  "maven:3.9.15-eclipse-temurin-25@sha256:1c3a703ab39fee7ac0880f46e6ccd22c0d701f17f0616e6e66a258ddc1c637d2";
// renovate: datasource=docker depName=texlive/texlive
export const TEXLIVE_IMAGE =
  "texlive/texlive:TL2024-historic@sha256:fd576ce8b1cfd03cdabc15ca75682fb050eb10de5c057d81449883c2ad644855";
// renovate: datasource=docker depName=caddy
export const CADDY_IMAGE =
  "caddy:2.11.3-alpine@sha256:86deaf5e3d3408a6ccec08fbb79989783dd26e206ae10bcf78a801dc8c9ab794";
// renovate: datasource=docker depName=caddy
export const CADDY_BUILDER_IMAGE =
  "caddy:2.11.3-builder-alpine@sha256:3eae6b351ecdb05da6d16e341261a457692d344a435764c5ece7a60cf03a23f3";
// Base image for obsidian-headless container (uses Node, not Bun, due to native better-sqlite3 addon).
// renovate: datasource=docker depName=node
export const OBSIDIAN_HEADLESS_BASE_IMAGE =
  "node:24-slim@sha256:242549cd46785b480c832479a730f4f2a20865d61ea2e404fdb2a5c3d3b73ecf";
// renovate: datasource=docker depName=alpine/helm
export const HELM_IMAGE =
  "alpine/helm:4.1.4@sha256:8edcaedab4d9864886b7f443d55731be87d4b5ec7dca714c24551455707a8aac";

// Quality-step scanner images (used by .dagger/src/quality.ts).
// Pinned with `@sha256:` digests to match every other image constant in
// this file — a mutable tag would let an upstream registry mutation
// silently alter the security tooling without a Renovate signal.
// renovate: datasource=docker depName=aquasec/trivy
export const TRIVY_IMAGE =
  "aquasec/trivy:0.70.0@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e";
// renovate: datasource=docker depName=semgrep/semgrep
export const SEMGREP_IMAGE =
  "semgrep/semgrep:1.162.0@sha256:9349edbadf90c3f3c0c3f55867625354e89680e6fa10d9034042af52fdb0e0d0";
// renovate: datasource=docker depName=zricethezav/gitleaks
export const GITLEAKS_IMAGE =
  "zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";
// renovate: datasource=docker depName=koalaman/shellcheck-alpine
export const SHELLCHECK_IMAGE =
  "koalaman/shellcheck-alpine:v0.11.0@sha256:9955be09ea7f0dbf7ae942ac1f2094355bb30d96fffba0ec09f5432207544002";

// Pinned Bun version for containers that install Bun manually (e.g. Playwright)
// renovate: datasource=npm depName=bun
export const BUN_VERSION = "1.3.14";

// renovate: datasource=npm depName=release-please
export const RELEASE_PLEASE_VERSION = "17.6.0";

// renovate: datasource=npm depName=@anthropic-ai/claude-code
export const CLAUDE_CODE_VERSION = "2.1.140";

// renovate: datasource=npm depName=@openai/codex
export const CODEX_CLI_VERSION = "0.130.0";

// renovate: datasource=github-releases depName=golangci/golangci-lint
export const GOLANGCI_LINT_VERSION = "v2.12.2";

// renovate: datasource=github-releases depName=cli/cli
export const GH_CLI_VERSION = "2.92.0";

// renovate: datasource=github-releases depName=kubernetes/kubectl
export const KUBECTL_VERSION = "v1.36.1";

// renovate: datasource=github-releases depName=github/github-mcp-server
export const GITHUB_MCP_SERVER_VERSION = "1.0.4";

// renovate: datasource=github-releases depName=siderolabs/talos
export const TALOSCTL_VERSION = "v1.13.3";

// renovate: datasource=github-releases depName=opentofu/opentofu
export const TOFU_VERSION = "1.11.7";

// renovate: datasource=github-releases depName=argoproj/argo-cd
export const ARGOCD_CLI_VERSION = "v3.4.2";

// renovate: datasource=github-releases depName=vmware-tanzu/velero
export const VELERO_CLI_VERSION = "v1.18.0";

// renovate: datasource=github-releases depName=buildkite/cli
export const BUILDKITE_CLI_VERSION = "3.42.0";

// renovate: datasource=github-releases depName=temporalio/cli
export const TEMPORAL_CLI_VERSION = "1.7.0";

// ---------------------------------------------------------------------------
// Cache volume names (stable — never include version numbers)
// ---------------------------------------------------------------------------

export const BUN_CACHE = "bun-install-cache";
export const ESLINT_CACHE = "eslint-cache";
export const CARGO_REGISTRY = "cargo-registry";
export const CARGO_TARGET = "cargo-target";
export const GO_MOD = "go-mod";
export const GO_BUILD = "go-build";
export const MAVEN_CACHE = "maven-local-repo";

// ---------------------------------------------------------------------------
// Source directory exclusions
// ---------------------------------------------------------------------------

/** Directories excluded when mounting source into containers. */
export const SOURCE_EXCLUDES = [
  "**/node_modules",
  "**/.eslintcache",
  "**/dist",
  "**/target",
  ".git",
  "**/.vscode",
  "**/.idea",
  "**/coverage",
  "**/build",
  "**/.next",
  "**/.tsbuildinfo",
  "**/__pycache__",
  "**/.DS_Store",
  "**/archive",
  "**/practice",
];
