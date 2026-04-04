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
export const BUN_IMAGE = "oven/bun:1.3.11";
// renovate: datasource=docker depName=rust
export const RUST_IMAGE = "rust:1.89.0-bookworm";
// renovate: datasource=docker depName=golang
export const GO_IMAGE = "golang:1.25.4-bookworm";
// renovate: datasource=docker depName=mcr.microsoft.com/playwright
export const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.58.2-noble";
// renovate: datasource=docker depName=ghcr.io/realm/swiftlint
export const SWIFTLINT_IMAGE = "ghcr.io/realm/swiftlint:0.58.2";
// renovate: datasource=docker depName=alpine
export const ALPINE_IMAGE = "alpine:3.21";
// renovate: datasource=docker depName=hashicorp/terraform
export const TOFU_IMAGE = "ghcr.io/opentofu/opentofu:1.9.0";
// renovate: datasource=docker depName=maven
export const MAVEN_IMAGE = "maven:3.9.9-eclipse-temurin-21";
// renovate: datasource=docker depName=texlive/texlive
export const TEXLIVE_IMAGE = "texlive/texlive:TL2024-historic";
// renovate: datasource=docker depName=caddy
export const CADDY_IMAGE = "caddy:2.9.1-alpine";
// renovate: datasource=docker depName=caddy
export const CADDY_BUILDER_IMAGE =
  "caddy:2-builder-alpine@sha256:17a3a99c747d2124b9e9a6f434905b2869d67d9fc278b00f3deba5f4a69254bc";
// renovate: datasource=docker depName=python
export const PYTHON_IMAGE = "python:3.13-slim";

// Pinned Bun version for containers that install Bun manually (e.g. Playwright)
// renovate: datasource=npm depName=bun
export const BUN_VERSION = "1.3.11";

// renovate: datasource=npm depName=release-please
export const RELEASE_PLEASE_VERSION = "17.3.0";

// renovate: datasource=npm depName=@anthropic-ai/claude-code
export const CLAUDE_CODE_VERSION = "2.1.71";

// renovate: datasource=github-releases depName=golangci/golangci-lint
export const GOLANGCI_LINT_VERSION = "v2.1.6";

// renovate: datasource=github-releases depName=cli/cli
export const GH_CLI_VERSION = "2.74.0";

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
