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
  "rust:1.96.0-bookworm@sha256:5e2214abe154fe26e39f64488952e5c991eeed1d6d6da7cc8381ae83927f0cfc";
// renovate: datasource=docker depName=golang
export const GO_IMAGE =
  "golang:1.26.5-bookworm@sha256:18aedc16aa19b3fd7ded7245fc14b109e054d65d22ed53c355c899582bbb2113";
// renovate: datasource=docker registryUrl=https://ghcr.io depName=astral-sh/uv
export const PYTHON_UV_IMAGE =
  "ghcr.io/astral-sh/uv:0.11.28-python3.12-trixie-slim@sha256:3137a0b606f65a74ee0245f43dae219b09e8af98fc37fef20841cbceef35a646";
// renovate: datasource=pypi depName=ruff
export const RUFF_VERSION = "0.15.21";
// renovate: datasource=pypi depName=pyright
export const PYRIGHT_VERSION = "1.1.411";
// renovate: datasource=docker depName=mcr.microsoft.com/playwright
export const PLAYWRIGHT_IMAGE =
  "mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48";
// renovate: datasource=docker depName=ghcr.io/realm/swiftlint
export const SWIFTLINT_IMAGE =
  "ghcr.io/realm/swiftlint:0.65.0@sha256:a482729f4b58741875af1566f23397f3f6db300372756fc31606d0a4527fab9e";
// renovate: datasource=docker depName=alpine
export const ALPINE_IMAGE =
  "alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b";
// renovate: datasource=docker registryUrl=https://ghcr.io depName=opentofu/opentofu
export const TOFU_IMAGE =
  "ghcr.io/opentofu/opentofu:1.12.3@sha256:a0766d12f07b43e66f2ed40d7a8babe97d581d20339c68ad0ab561737af9a5b3";
// renovate: datasource=docker depName=maven
export const MAVEN_IMAGE =
  "maven:3.9.16-eclipse-temurin-25@sha256:7e461cec477077c1d9e50b13df8aef9018764410f4c4cd7c34803f10c4c99e4c";
// renovate: datasource=docker depName=texlive/texlive
export const TEXLIVE_IMAGE =
  "texlive/texlive:TL2024-historic@sha256:ee8ab695a9640d119482eff320c79b2292c70694d068aeb15ff4720761af8839";
// renovate: datasource=docker depName=caddy
export const CADDY_IMAGE =
  "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";
// renovate: datasource=docker depName=caddy
export const CADDY_BUILDER_IMAGE =
  "caddy:2.11.4-builder-alpine@sha256:8e89605351333ad2cc2f3bcc95275a2ccc427f88914050e86a5fde0fd77a63c4";
// xcaddy --with module for the S3 proxy plugin. The fork keeps the upstream
// import path (existing Caddyfiles keep working) and adds HEAD support, the
// 304-on-index fix, and 206/Accept-Ranges on byte-range responses (Safari
// refuses to play video from origins that answer 200 to Range requests).
// Not managed by renovate — bump the tag when the fork changes.
export const CADDY_S3_PROXY_MODULE =
  "github.com/lindenlab/caddy-s3-proxy=github.com/shepherdjerred/caddy-s3-proxy@v0.5.7-head2";
// redlib is built from source ourselves (Dockerfile.ubuntu) rather than pulled
// from quay. Upstream only publishes a musl/Alpine image whose TLS fingerprint
// Reddit now blocks during OAuth (redlib-org/redlib#551 — "Failed to create
// OAuth client: 401 Unauthorized"); the glibc Dockerfile.ubuntu build works.
// The fingerprint fixes live on `main` — the last GitHub release (v0.36.0,
// 2025-03) predates them, and the numerically-newest tag (v3.0.0) is a 2021
// libreddit-era relic — so we pin main's HEAD commit and let Renovate's
// dedicated git-refs custom manager (see renovate.json) advance it as main moves.
// renovate: datasource=git-refs depName=redlib-source branch=main
export const REDLIB_SOURCE_REF = "a4d36e954cf1bd64f209cd8868c5a29edc81b374";
// Base image for obsidian-headless container (uses Node, not Bun, due to native better-sqlite3 addon).
// Also reused as the Node builder stage for the custom mcp-gateway image (edstem-mcp build).
// renovate: datasource=docker depName=node
export const OBSIDIAN_HEADLESS_BASE_IMAGE =
  "node:24-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5";

// Base image for the custom mcp-gateway image. Layered with a prebuilt edstem-mcp
// (rob-9/edstem-mcp is git-only, has no committed dist, and no build-on-install,
// so plain npx-from-git fails). Keep this digest in sync with the
// "tbxark/mcp-proxy" entry in packages/homelab/src/cdk8s/src/versions.ts.
// renovate: datasource=docker registryUrl=https://ghcr.io versioning=semver
export const MCP_PROXY_BASE_IMAGE =
  "ghcr.io/tbxark/mcp-proxy:v0.43.2@sha256:1c43164a910a4f74a3ce48d95cb2ef792de8d467296555e63944fa798f0a44bd";

// Pinned commit of rob-9/edstem-mcp baked into the custom mcp-gateway image.
// Bump to pick up upstream fixes (changes the Dagger build cache key).
export const EDSTEM_MCP_COMMIT = "661a3c498c82f47b1d352410b53fa06c6806c949";

// emscripten toolchain for the discord-plays-mario-kart N64Wasm core build.
// Pinned to 2.0.7 — the exact toolchain the vendored parallel-n64 + angrylion
// source (packages/discord-plays-mario-kart/wasm-src) is known to compile with.
// Not Renovate-managed: a newer emsdk silently breaks the legacy SDL2/GLES2
// build, so the version is intentionally frozen until the core is reworked.
export const EMSCRIPTEN_IMAGE =
  "emscripten/emsdk:2.0.7@sha256:cbeeb7cccd2e7915fe0596345f10bfdec5578cc0386aaa823ad6f1d41910619f";

// Toolchain image for the discord-plays-pokemon pokeemerald.wasm build. The
// build uses clang `wasm32-unknown-unknown` + `wasm-ld` (NOT emscripten), so it
// needs a modern LLVM plus the GBA-decomp host-tool deps (libpng/zlib for
// gbagfx, python/uv for the sound-data tooling). bookworm's clang-14 links a
// wasm JSC/Bun rejects ("function index exceeds function index space"); trixie's
// clang-19 produces a Bun-loadable, behaviorally-equivalent binary.
// renovate: datasource=docker depName=debian
export const POKEEMERALD_WASM_TOOLCHAIN_IMAGE =
  "debian:trixie-slim@sha256:28de0877c2189802884ccd20f15ee41c203573bd87bb6b883f5f46362d24c5c2";

// Pinned commit of ottohg/pokeemerald-wasm built from source into the
// discord-plays-pokemon backend image (.dagger/src/image.ts). ottohg's fork adds
// the full C m4a audio engine + the host-PCM exports tripplyons's upstream stubs
// out; a checked-in patch (packages/discord-plays-pokemon/wasm-src/patches) adds
// the four game-state exports our symbols.ts reads. Pinned for reproducibility;
// the git-refs custom manager below advances it as ottohg `master` moves.
// renovate: datasource=git-refs depName=pokeemerald-source branch=master
export const POKEEMERALD_SOURCE_REF =
  "c101be5ac2ae53c5d18ee063f16eeeda751639f8";
// renovate: datasource=docker depName=alpine/helm
export const HELM_IMAGE =
  "alpine/helm:4.2.2@sha256:ee6fe3e96d9f8ea8dd1af9ecd7bbb3e233616a25f145392376f020fd2a51eb33";

// Quality-step scanner images (used by .dagger/src/quality.ts).
// Pinned with `@sha256:` digests to match every other image constant in
// this file — a mutable tag would let an upstream registry mutation
// silently alter the security tooling without a Renovate signal.
// renovate: datasource=docker depName=aquasec/trivy
export const TRIVY_IMAGE =
  "aquasec/trivy:0.72.0@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f";
// renovate: datasource=docker depName=semgrep/semgrep
export const SEMGREP_IMAGE =
  "semgrep/semgrep:1.165.0@sha256:f4791a54c891eabe1188248135574e6e03dfc31dfd3f3b747c7bec7079bfed1b";
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
export const RELEASE_PLEASE_VERSION = "17.7.0";

// renovate: datasource=npm depName=@anthropic-ai/claude-code
export const CLAUDE_CODE_VERSION = "2.1.175";

// renovate: datasource=npm depName=@openai/codex
export const CODEX_CLI_VERSION = "0.139.0";

// cogapp regenerates the README project-listing tables in the temporal-worker's
// readme-refresh-weekly workflow (see withCogapp in image.ts).
// renovate: datasource=pypi depName=cogapp
export const COGAPP_VERSION = "3.6.0";

// renovate: datasource=github-releases depName=golangci/golangci-lint
export const GOLANGCI_LINT_VERSION = "v2.12.2";

// renovate: datasource=github-releases depName=cli/cli
export const GH_CLI_VERSION = "2.96.0";

// renovate: datasource=github-releases depName=kubernetes/kubectl
export const KUBECTL_VERSION = "v1.36.2";

// renovate: datasource=github-releases depName=github/github-mcp-server
export const GITHUB_MCP_SERVER_VERSION = "1.3.0";

// renovate: datasource=github-releases depName=siderolabs/talos
export const TALOSCTL_VERSION = "v1.13.6";

// renovate: datasource=github-releases depName=opentofu/opentofu
export const TOFU_VERSION = "1.12.3";

// renovate: datasource=github-releases depName=argoproj/argo-cd
export const ARGOCD_CLI_VERSION = "v3.4.5";

// renovate: datasource=github-releases depName=vmware-tanzu/velero
export const VELERO_CLI_VERSION = "v1.18.2";

// renovate: datasource=github-releases depName=buildkite/cli
export const BUILDKITE_CLI_VERSION = "3.48.0";

// renovate: datasource=github-releases depName=temporalio/cli
export const TEMPORAL_CLI_VERSION = "1.7.3";

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
  "**/.venv",
  "**/.DS_Store",
  "**/archive",
  "**/practice",
];
