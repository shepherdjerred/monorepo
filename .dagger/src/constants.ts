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
  "oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e";
// renovate: datasource=docker depName=rust
export const RUST_IMAGE =
  "rust:1.95.0-bookworm@sha256:503651ea31e66ecb74623beabde781059a5978df1595a9e8ed03974d5fec1bf0";
// renovate: datasource=docker depName=golang
export const GO_IMAGE =
  "golang:1.26.3-bookworm@sha256:252599aeb51ad60b83e4d8821802068127c528c707cb7dd7afd93be057c6011c";
// renovate: datasource=docker depName=mcr.microsoft.com/playwright
export const PLAYWRIGHT_IMAGE =
  "mcr.microsoft.com/playwright:v1.59.1-noble@sha256:b0ab6f3cb99aa7803adbc14d9027ec1785fc6e433b97e134e0f8fe61683b6b53";
// renovate: datasource=docker depName=ghcr.io/realm/swiftlint
export const SWIFTLINT_IMAGE =
  "ghcr.io/realm/swiftlint:0.63.2@sha256:8db376ff8a26e56fa506b56b8c70ea9c5583dc52d5746ce23b6c2c4d4ee00e31";
// renovate: datasource=docker depName=alpine
export const ALPINE_IMAGE =
  "alpine:3.23@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11";
// renovate: datasource=docker registryUrl=https://ghcr.io depName=opentofu/opentofu
export const TOFU_IMAGE =
  "ghcr.io/opentofu/opentofu:1.11.6@sha256:9180b542ee250ea2f26b22144190980d8bfbc86885213f6cb18d48a621d4abff";
// renovate: datasource=docker depName=maven
export const MAVEN_IMAGE =
  "maven:3.9.15-eclipse-temurin-25@sha256:1c3a703ab39fee7ac0880f46e6ccd22c0d701f17f0616e6e66a258ddc1c637d2";
// renovate: datasource=docker depName=texlive/texlive
export const TEXLIVE_IMAGE =
  "texlive/texlive:TL2024-historic@sha256:fd576ce8b1cfd03cdabc15ca75682fb050eb10de5c057d81449883c2ad644855";
// renovate: datasource=docker depName=caddy
export const CADDY_IMAGE =
  "caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d";
// renovate: datasource=docker depName=caddy
export const CADDY_BUILDER_IMAGE =
  "caddy:2.11.2-builder-alpine@sha256:ced7ea0d093d2ce6d3e28869640f0513afb96e42675f399de062a17bab54b434";
// renovate: datasource=docker depName=python
export const PYTHON_IMAGE =
  "python:3.14-slim@sha256:1697e8e8d39bf168e177ac6b5fdab6df86d81cfc24dae17dfb96cfc3ef76b4dd";

// Base image for obsidian-headless container (uses Node, not Bun, due to native better-sqlite3 addon).
// renovate: datasource=docker depName=node
export const OBSIDIAN_HEADLESS_BASE_IMAGE =
  "node:24-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e";
// renovate: datasource=docker depName=alpine/helm
export const HELM_IMAGE =
  "alpine/helm:4.1.4@sha256:4b0bdd2cf18ff6bca12aba0b2c5671384dab5035c19c57f0c58b854a0baf65be";

// Pinned Bun version for containers that install Bun manually (e.g. Playwright)
// renovate: datasource=npm depName=bun
export const BUN_VERSION = "1.3.13";

// renovate: datasource=npm depName=release-please
export const RELEASE_PLEASE_VERSION = "17.6.0";

// renovate: datasource=npm depName=@anthropic-ai/claude-code
export const CLAUDE_CODE_VERSION = "2.1.138";

// renovate: datasource=github-releases depName=golangci/golangci-lint
export const GOLANGCI_LINT_VERSION = "v2.12.2";

// renovate: datasource=github-releases depName=cli/cli
export const GH_CLI_VERSION = "2.92.0";

// renovate: datasource=github-releases depName=kubernetes/kubectl
export const KUBECTL_VERSION = "v1.35.0";

// renovate: datasource=github-releases depName=github/github-mcp-server
export const GITHUB_MCP_SERVER_VERSION = "1.0.3";

// renovate: datasource=github-releases depName=siderolabs/talos
export const TALOSCTL_VERSION = "v1.13.0";

// renovate: datasource=github-releases depName=opentofu/opentofu
export const TOFU_VERSION = "1.11.6";

// renovate: datasource=github-releases depName=argoproj/argo-cd
export const ARGOCD_CLI_VERSION = "v3.4.1";

// renovate: datasource=github-releases depName=vmware-tanzu/velero
export const VELERO_CLI_VERSION = "v1.18.0";

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
