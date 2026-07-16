# syntax=docker/dockerfile:1.7-labs
# temporal-worker image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
#
# This image bakes in the operator CLIs the worker's scheduled workflows shell
# out to: gh + claude (pr-agent PR review/summary + scout/homelab Claude runs),
# codex (agent-task Codex provider + readme-refresh new-package summaries),
# kubectl (bugsink-housekeeping / zfs-maintenance `kubectl exec`),
# github-mcp-server (pr-agent's MCP GitHub backend), talosctl / tofu / argocd /
# velero / bk / temporal / toolkit (homelab-audit-daily runbook + preflight —
# see src/activities/homelab-audit-preflight.ts REQUIRED_AUDIT_BINARIES), and
# cog (readme-refresh-weekly regenerates the README project-listing tables).
# This mirrors the old Dagger buildTemporalWorkerImageHelper (withEditorClis +
# withKubectl + withGithubMcpServer + withHomelabAuditClis + withCogapp +
# withToolkit). scripts/smoke.ts asserts every one of these boots + is on PATH.
#
# Arch: the production cluster is amd64; local builds are arm64. Every download
# is arch-guarded (`dpkg --print-architecture`) so both build with native
# binaries — no QEMU fallback needed.
FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Pinned CLI versions (mirror the old .dagger/src/constants.ts). Renovate
# annotations let the same datasources keep these current as they did for the
# Dagger constants.
# renovate: datasource=github-releases depName=cli/cli
ARG GH_CLI_VERSION=2.96.0
# renovate: datasource=npm depName=@anthropic-ai/claude-code
ARG CLAUDE_CODE_VERSION=2.1.175
# renovate: datasource=npm depName=@openai/codex
ARG CODEX_CLI_VERSION=0.139.0
# renovate: datasource=github-releases depName=kubernetes/kubectl
ARG KUBECTL_VERSION=v1.36.2
# renovate: datasource=github-releases depName=github/github-mcp-server
ARG GITHUB_MCP_SERVER_VERSION=1.3.0
# renovate: datasource=github-releases depName=siderolabs/talos
ARG TALOSCTL_VERSION=v1.13.6
# renovate: datasource=github-releases depName=opentofu/opentofu
ARG TOFU_VERSION=1.12.3
# renovate: datasource=github-releases depName=argoproj/argo-cd
ARG ARGOCD_CLI_VERSION=v3.4.5
# renovate: datasource=github-releases depName=vmware-tanzu/velero
ARG VELERO_CLI_VERSION=v1.18.2
# renovate: datasource=github-releases depName=buildkite/cli
ARG BUILDKITE_CLI_VERSION=3.48.0
# renovate: datasource=github-releases depName=temporalio/cli
ARG TEMPORAL_CLI_VERSION=1.7.3
# renovate: datasource=pypi depName=cogapp
ARG COGAPP_VERSION=3.6.0

# --- Base system deps: ca-certificates, curl, git (gh/claude open PRs) ---
RUN set -e; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends ca-certificates curl git; \
    rm -rf /var/lib/apt/lists/*

# --- gh CLI (per-arch release tarball) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) gharch=amd64 ;; arm64) gharch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_${gharch}.tar.gz" \
      | tar xz -C /usr/local/bin --strip-components=2 "gh_${GH_CLI_VERSION}_linux_${gharch}/bin/gh"; \
    gh --version

# --- Claude Code + Codex CLIs (bun global installs) ---
# BUN_INSTALL=/usr/local drops `bun add -g` binaries into /usr/local/bin
# (on PATH, world-readable) instead of /root/.bun/bin. Scoped to this layer so
# it doesn't leak into the workspace install below (which must use the base's
# default install prefix). Mirrors the old withEditorClis / withCodexCli.
RUN BUN_INSTALL=/usr/local bun add -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && claude --version
RUN BUN_INSTALL=/usr/local bun add -g "@openai/codex@${CODEX_CLI_VERSION}" && codex --version

# --- kubectl (per-arch, SHA256-verified against dl.k8s.io) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) k8sarch=amd64 ;; arm64) k8sarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${k8sarch}/kubectl"; \
    curl -fsSL "$base" -o /usr/local/bin/kubectl; \
    curl -fsSL "$base.sha256" -o /tmp/kubectl.sha256; \
    echo "$(cat /tmp/kubectl.sha256)  /usr/local/bin/kubectl" | sha256sum -c -; \
    chmod +x /usr/local/bin/kubectl; \
    rm /tmp/kubectl.sha256; \
    kubectl version --client

# --- github-mcp-server (per-arch tarball, SHA256-verified) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) gmsarch=x86_64 ;; arm64) gmsarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/github/github-mcp-server/releases/download/v${GITHUB_MCP_SERVER_VERSION}"; \
    tarball="github-mcp-server_Linux_${gmsarch}.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/gms.tar.gz; \
    curl -fsSL "$base/github-mcp-server_${GITHUB_MCP_SERVER_VERSION}_checksums.txt" -o /tmp/gms.checksums.txt; \
    expected="$(grep " $tarball$" /tmp/gms.checksums.txt | awk '{print $1}')"; \
    [ -n "$expected" ] || { echo "no checksum entry for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/gms.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "github-mcp-server checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    tar -xzf /tmp/gms.tar.gz -C /usr/local/bin github-mcp-server; \
    chmod +x /usr/local/bin/github-mcp-server; \
    rm /tmp/gms.tar.gz /tmp/gms.checksums.txt; \
    github-mcp-server --version

# --- talosctl (per-arch binary; no stable checksums file — verify by exec) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) tarch=amd64 ;; arm64) tarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://github.com/siderolabs/talos/releases/download/${TALOSCTL_VERSION}/talosctl-linux-${tarch}" \
      -o /usr/local/bin/talosctl; \
    chmod +x /usr/local/bin/talosctl; \
    talosctl version --client

# --- OpenTofu (per-arch tarball, SHA256-verified) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) tofuarch=amd64 ;; arm64) tofuarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}"; \
    tarball="tofu_${TOFU_VERSION}_linux_${tofuarch}.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/tofu.tar.gz; \
    curl -fsSL "$base/tofu_${TOFU_VERSION}_SHA256SUMS" -o /tmp/tofu.checksums.txt; \
    expected="$(grep " $tarball$" /tmp/tofu.checksums.txt | awk '{print $1}')"; \
    [ -n "$expected" ] || { echo "no checksum entry for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/tofu.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "tofu checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    tar -xzf /tmp/tofu.tar.gz -C /usr/local/bin tofu; \
    chmod +x /usr/local/bin/tofu; \
    rm /tmp/tofu.tar.gz /tmp/tofu.checksums.txt; \
    tofu version

# --- ArgoCD CLI (per-arch binary; no stable checksums file — verify by exec) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) acarch=amd64 ;; arm64) acarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://github.com/argoproj/argo-cd/releases/download/${ARGOCD_CLI_VERSION}/argocd-linux-${acarch}" \
      -o /usr/local/bin/argocd; \
    chmod +x /usr/local/bin/argocd; \
    argocd version --client

# --- Velero CLI (per-arch tarball) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) varch=amd64 ;; arm64) varch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    dir="velero-${VELERO_CLI_VERSION}-linux-${varch}"; \
    curl -fsSL "https://github.com/vmware-tanzu/velero/releases/download/${VELERO_CLI_VERSION}/${dir}.tar.gz" \
      -o /tmp/velero.tar.gz; \
    tar -xzf /tmp/velero.tar.gz -C /tmp; \
    mv "/tmp/${dir}/velero" /usr/local/bin/velero; \
    chmod +x /usr/local/bin/velero; \
    rm -rf /tmp/velero.tar.gz "/tmp/${dir}"; \
    velero version --client-only

# --- Buildkite CLI (per-arch tarball, SHA256-verified) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) bkarch=amd64 ;; arm64) bkarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/buildkite/cli/releases/download/v${BUILDKITE_CLI_VERSION}"; \
    dir="bk_${BUILDKITE_CLI_VERSION}_linux_${bkarch}"; \
    tarball="${dir}.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/bk.tar.gz; \
    curl -fsSL "$base/bk_${BUILDKITE_CLI_VERSION}_checksums.txt" -o /tmp/bk.checksums.txt; \
    expected="$(grep " $tarball$" /tmp/bk.checksums.txt | awk '{print $1}')"; \
    [ -n "$expected" ] || { echo "no checksum entry for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/bk.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "bk checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    tar -xzf /tmp/bk.tar.gz -C /usr/local/bin --strip-components=1 "${dir}/bk"; \
    chmod +x /usr/local/bin/bk; \
    rm /tmp/bk.tar.gz /tmp/bk.checksums.txt; \
    bk --version

# --- Temporal CLI (per-arch tarball, SHA256-verified) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) tcarch=amd64 ;; arm64) tcarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/temporalio/cli/releases/download/v${TEMPORAL_CLI_VERSION}"; \
    tarball="temporal_cli_${TEMPORAL_CLI_VERSION}_linux_${tcarch}.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/temporal.tar.gz; \
    curl -fsSL "$base/checksums.txt" -o /tmp/temporal.checksums.txt; \
    expected="$(grep " $tarball$" /tmp/temporal.checksums.txt | awk '{print $1}')"; \
    [ -n "$expected" ] || { echo "no checksum entry for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/temporal.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "temporal checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    tar -xzf /tmp/temporal.tar.gz -C /usr/local/bin temporal; \
    chmod +x /usr/local/bin/temporal; \
    rm /tmp/temporal.tar.gz /tmp/temporal.checksums.txt; \
    temporal --version

# --- cog (cogapp): Python + pip, install system-wide into /usr/local/bin ---
# readme-refresh-weekly runs `cog -r README.md ...` to regenerate the project
# tables. cog's `-v` (not `--version`) prints the version and exits 0.
RUN set -e; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends python3 python3-pip; \
    rm -rf /var/lib/apt/lists/*; \
    pip3 install --no-cache-dir --break-system-packages "cogapp==${COGAPP_VERSION}"; \
    cog -v

# --- Manifests-first install layer (CLI layers above cache independently) ---
# This ~6 GB `bun install` layer only invalidates when a manifest/lockfile/patch
# changes, not on every source edit. `--frozen-lockfile` requires every
# workspace member's package.json present, so the globs enumerate all 47 members
# (top-level, nested packages/*/packages/*, homelab/src/*, the desktop src-tauri
# crate, and the `scripts` dir). node_modules/dist are excluded from the build
# context by the root .dockerignore, so the later `COPY . .` can't clobber the
# installed tree.
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile

# Now the sources (source COPY last so a code-only edit keeps the install layer
# cached).
COPY . .

# llm-models' package `main`/`exports` resolve to a gitignored `dist/`, so a
# consumer that imports it (temporal's pr-review cost activity) crashes at
# startup with `Cannot find module '@shepherdjerred/llm-models'` unless the
# catalog is compiled first. (home-assistant and llm-observability export their
# `src/` directly and need no build.) Mirrors the old Dagger `withBuiltLlmModels`.
RUN cd packages/llm-models && bun run build

# Compile the in-tree toolkit CLI into a single static binary on PATH. The
# homelab-audit runbook + preflight shell out to `toolkit pd|bugsink|gf|recall`;
# it's compiled here (not `bun add -g`) because it lives in the workspace source.
# `--external ffmpeg-static` matches the package's own build script (a native
# shim that must not be bundled). Mirrors the old Dagger `withToolkit`.
RUN cd packages/toolkit && bun build ./src/index.ts --compile --external ffmpeg-static --outfile=/usr/local/bin/toolkit \
    && chmod +x /usr/local/bin/toolkit \
    && toolkit --version

# The worker imports `#generated/ha-schema.ts` (type-only, but keep the file
# present so any runtime `import` resolves). ensure-ha-schema copies the
# committed stub into place if a generated schema isn't present. Idempotent.
RUN bun packages/temporal/scripts/ensure-ha-schema.ts

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Point Bun's runtime install cache at a writable path (the base sets
# BUN_INSTALL=/usr/local, whose install/cache is root-owned) — mirrors the old
# Dagger image's BUN_INSTALL_CACHE_DIR fix.
ENV BUN_INSTALL_CACHE_DIR=/tmp/bun-install-cache

# Run from the package dir so Bun resolves this package's tsconfig + imports map
# (the `#generated/*`, `#activities/*`, … subpath imports).
WORKDIR /app/packages/temporal
CMD ["bun", "src/worker.ts"]
