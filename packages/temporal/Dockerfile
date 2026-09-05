# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
# temporal-worker image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
#
# This image bakes in the operator CLIs the worker's scheduled workflows shell
# out to: gh (pr-agent PR review/summary + PR creation),
# kubectl (bugsink-housekeeping / zfs-maintenance `kubectl exec`),
# github-mcp-server (pr-agent's MCP GitHub backend), talosctl / tofu / argocd /
# velero / bk / temporal / gcx / toolkit (homelab-audit-daily runbook + preflight —
# see src/activities/homelab-audit-preflight.ts REQUIRED_AUDIT_BINARIES),
# and the direct maintenance runtimes Kometa, uv, and Trivy.
# scripts/smoke.ts asserts every one of these boots + is on PATH.
#
# Multi-stage: deps does a full (dev-inclusive) install to feed shared-package
# and toolkit builds; prod-deps installs the production-only worker closure;
# runtime carries the CLI zoo plus COPY-only app layers — it never runs
# `bun install`. Dev dependencies and the rest of the monorepo source never
# reach the final image, and the source layer only invalidates when a closure
# package changes — not on every repo commit.
#
# Arch: the production cluster is amd64; local builds are arm64. Every download
# is arch-guarded (`dpkg --print-architecture`) so both build with native
# binaries — no QEMU fallback needed.
FROM oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS base
WORKDIR /app

# ── deps: full install (dev deps) — feeds the artifact builds below ─────────
# `--frozen-lockfile` requires every workspace member's package.json present,
# so the globs enumerate every member (top-level, nested packages/*/packages/*,
# homelab/src/*, the desktop src-tauri crate, and the `scripts` dir).
FROM base AS deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile \
  --filter '@shepherdjerred/temporal' \
  --filter '@shepherdjerred/toolkit'

# ── build: gitignored artifacts (shared dist + compiled toolkit) ────────────
FROM deps AS build
COPY --parents \
  tsconfig.base.json \
  packages/scout-for-lol/tsconfig.base.json \
  packages/temporal \
  packages/feature-flags \
  packages/code-review \
  packages/glitter-context \
  packages/home-assistant \
  packages/llm-models \
  packages/scout-for-lol/packages/data \
  packages/seaweedfs-backup \
  packages/toolkit \
  ./
# Home Assistant is published with a dist-based export. Build it in the
# artifact stage so the runtime image does not resolve the workspace link to a
# source package with no gitignored dist directory.
RUN cd packages/home-assistant && bun run build
# llm-models' package `main`/`exports` resolve to a gitignored `dist/`, so a
# consumer that imports it (temporal's pr-review cost activity) crashes at
# startup with `Cannot find module '@shepherdjerred/llm-models'` unless the
# catalog is compiled first. (home-assistant and llm-observability export their
# `src/` directly and need no build.)
RUN cd packages/llm-models && bun run build
# The weekly parlay lifecycle is exported as a bundled module so the runtime
# image never depends on source JSON loading or a gitignored developer dist.
RUN cd packages/scout-for-lol/packages/data && bun run build
# Glitter context also exports gitignored dist files. Its build validates and
# bundles the language-neutral JSON before Temporal imports it at startup.
RUN cd packages/glitter-context && bun run build
# Compile the in-tree toolkit CLI into a single static binary. The
# homelab-audit runbook + preflight shell out through toolkit workflows and
# native CLI passthroughs (`alerts`, `bugsink`, `prom`, `loki`, `grafana`);
# it's compiled here (not `bun add -g`) because it lives in the workspace
# source. `--external ffmpeg-static` matches the package's own build script (a
# native shim that must not be bundled).
RUN cd packages/toolkit && bun build ./src/index.ts --compile --external ffmpeg-static --outfile=/usr/local/bin/toolkit \
    && chmod +x /usr/local/bin/toolkit \
    && toolkit --version

# ── prod-deps: production-only node_modules, cached on manifests ────────────
FROM base AS prod-deps
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/temporal'

# ── runtime: operator CLIs + COPY-only app layers ───────────────────────────
FROM base AS runtime

# Fail-fast shell for every RUN in this stage: the CLI installs pipe curl into
# tar and cat into sha256sum, and a failed producer must fail the build rather
# than be masked by the consumer.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Pinned operator CLI versions.
# renovate: datasource=github-releases depName=cli/cli
ARG GH_CLI_VERSION=2.96.0
# renovate: datasource=github-releases depName=kubernetes/kubectl
ARG KUBECTL_VERSION=v1.36.3
# renovate: datasource=github-releases depName=github/github-mcp-server
ARG GITHUB_MCP_SERVER_VERSION=1.3.0
# renovate: datasource=github-releases depName=siderolabs/talos
ARG TALOSCTL_VERSION=v1.13.7
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
# renovate: datasource=github-releases depName=grafana/gcx
ARG GCX_VERSION=1.0.0
# renovate: datasource=pypi depName=uv
ARG UV_VERSION=0.12.3
# renovate: datasource=github-releases depName=aquasecurity/trivy
ARG TRIVY_VERSION=0.72.0
# lychee tags carry a `lychee-v` prefix, so the pinned value is the full tag.
# renovate: datasource=github-releases depName=lycheeverse/lychee versioning=loose
ARG LYCHEE_VERSION=lychee-v0.24.2
# renovate: datasource=github-releases depName=Kometa-Team/Kometa
ARG KOMETA_VERSION=2.4.5
# Shared local/CI Postgres pin — keep in lockstep with .mise.toml's
# "ubi:theseus-rs/postgresql-binaries" entry: the bot-clone backend tests must
# run against the same server binaries here as on dev/CI machines.
# renovate: datasource=github-releases depName=theseus-rs/postgresql-binaries
ARG POSTGRESQL_BINARIES_VERSION=16.15.0
ARG KOMETA_COMMIT=4ea818399a458f9e791ca04b4a02458751cf2a46

# --- Base system deps: ca-certificates, curl, git, libxml2, and the pod-local agent firewall ---
# libxml2 is for the postgresql-binaries `postgres` server below: only that one
# binary links it (pg_isready and initdb do not, which is why the step's own
# version checks passed while `postgres --version` died on a missing
# libxml2.so.2). Both the x86_64 and aarch64 tarballs need it.
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN set -e; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends ca-certificates curl git iptables libxml2 util-linux; \
    rm -rf /var/lib/apt/lists/*

# --- gh CLI (per-arch release tarball) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) gharch=amd64 ;; arm64) gharch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_${gharch}.tar.gz" \
      | tar xz -C /usr/local/bin --strip-components=2 "gh_${GH_CLI_VERSION}_linux_${gharch}/bin/gh"; \
    gh --version

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

# --- Grafana CLI (per-arch tarball, SHA256-verified) ---
# Supplies the native backend for toolkit's Grafana, Prometheus, Loki, and Tempo
# passthroughs. The release layout matches temporalio/cli above: a bare
# `gcx` binary at the tarball root plus a `<name>_<version>_checksums.txt`.
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) gcxarch=amd64 ;; arm64) gcxarch=arm64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/grafana/gcx/releases/download/v${GCX_VERSION}"; \
    tarball="gcx_${GCX_VERSION}_linux_${gcxarch}.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/gcx.tar.gz; \
    curl -fsSL "$base/gcx_${GCX_VERSION}_checksums.txt" -o /tmp/gcx.checksums.txt; \
    expected="$(grep " $tarball$" /tmp/gcx.checksums.txt | awk '{print $1}')"; \
    [ -n "$expected" ] || { echo "no checksum entry for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/gcx.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "gcx checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    tar -xzf /tmp/gcx.tar.gz -C /usr/local/bin gcx; \
    chmod +x /usr/local/bin/gcx; \
    rm /tmp/gcx.tar.gz /tmp/gcx.checksums.txt; \
    gcx --version

# --- Python + pip (required by the uv install below) ---
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN set -e; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends python3 python3-pip python3-venv; \
    rm -rf /var/lib/apt/lists/*

# --- uv (pinned PyPI release) ---
RUN pip3 install --no-cache-dir --break-system-packages "uv==${UV_VERSION}" && uv --version

# --- Trivy (per-arch release tarball, SHA256-verified) ---
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) trivyarch=64bit ;; arm64) trivyarch=ARM64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}"; \
    tarball="trivy_${TRIVY_VERSION}_Linux-${trivyarch}.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/trivy.tar.gz; \
    curl -fsSL "$base/trivy_${TRIVY_VERSION}_checksums.txt" -o /tmp/trivy.checksums.txt; \
    expected="$(grep " $tarball$" /tmp/trivy.checksums.txt | awk '{print $1}')"; \
    [ -n "$expected" ] || { echo "no checksum entry for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/trivy.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "trivy checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    tar -xzf /tmp/trivy.tar.gz -C /usr/local/bin trivy; \
    chmod +x /usr/local/bin/trivy; \
    rm /tmp/trivy.tar.gz /tmp/trivy.checksums.txt; \
    trivy version

# --- lychee (per-arch release tarball, SHA256-verified) ---
# Link-rot scanner for the weekly link-rot report. Each release asset ships a
# sibling `.sha256` file; the tarball nests the binary under
# `lychee-<target>/lychee`.
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) lycheearch=x86_64 ;; arm64) lycheearch=aarch64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/lycheeverse/lychee/releases/download/${LYCHEE_VERSION}"; \
    dir="lychee-${lycheearch}-unknown-linux-gnu"; \
    tarball="${dir}.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/lychee.tar.gz; \
    curl -fsSL "$base/$tarball.sha256" -o /tmp/lychee.sha256; \
    expected="$(awk '{print $1}' /tmp/lychee.sha256)"; \
    [ -n "$expected" ] || { echo "no checksum for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/lychee.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "lychee checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    tar -xzf /tmp/lychee.tar.gz -C /usr/local/bin --strip-components=1 "${dir}/lychee"; \
    chmod +x /usr/local/bin/lychee; \
    rm /tmp/lychee.tar.gz /tmp/lychee.sha256; \
    lychee --version

# --- Kometa (pinned source release, direct command-line install) ---
# Kometa's supported local installation is the repository's requirements.txt
# plus `python kometa.py`; keeping that layout in a venv preserves the exact
# direct CLI behavior while the Temporal activity supplies config/credentials.
RUN set -e; \
    git clone --depth 1 --branch "v${KOMETA_VERSION}" "https://github.com/Kometa-Team/Kometa.git" /opt/kometa; \
    actual_commit="$(git -C /opt/kometa rev-parse HEAD)"; \
    [ "$actual_commit" = "$KOMETA_COMMIT" ] || { echo "Kometa commit mismatch (expected $KOMETA_COMMIT, got $actual_commit)" >&2; exit 1; }; \
    python3 -m venv /opt/kometa/venv; \
    /opt/kometa/venv/bin/python -m pip install --no-cache-dir --upgrade pip; \
    /opt/kometa/venv/bin/pip install --no-cache-dir -r /opt/kometa/requirements.txt; \
    printf '%s\n' '#!/bin/sh' 'exec /opt/kometa/venv/bin/python /opt/kometa/kometa.py "$@"' > /usr/local/bin/kometa; \
    chmod +x /usr/local/bin/kometa; \
    kometa --help >/dev/null

# --- PostgreSQL server binaries (per-arch tarball, SHA256-verified) ---
# The Data Dragon updater's snapshot step runs scout-backend tests, and since
# the SQLite→Postgres migration (PR #2310) every backend test boots a local
# Postgres via ensureDevPostgres (pg_isready/psql/postgres/initdb/pg_ctl/
# createdb — packages/scout-for-lol/packages/backend/src/testing/
# postgres-server.ts). Dev/CI machines get these from mise; this image must
# carry them itself or the daily data-dragon workflow fails at its final step
# (ScoutDataDragonUpdateFailed, 2026-08-26). The full tree stays under
# /opt/postgresql because initdb resolves share/ relative to its prefix.
RUN set -e; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) pgarch=x86_64 ;; arm64) pgarch=aarch64 ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac; \
    base="https://github.com/theseus-rs/postgresql-binaries/releases/download/${POSTGRESQL_BINARIES_VERSION}"; \
    tarball="postgresql-${POSTGRESQL_BINARIES_VERSION}-${pgarch}-unknown-linux-gnu.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/postgresql.tar.gz; \
    curl -fsSL "$base/$tarball.sha256" -o /tmp/postgresql.sha256; \
    expected="$(awk '{print $1}' /tmp/postgresql.sha256)"; \
    [ -n "$expected" ] || { echo "no checksum for $tarball" >&2; exit 1; }; \
    actual="$(sha256sum /tmp/postgresql.tar.gz | awk '{print $1}')"; \
    [ "$expected" = "$actual" ] || { echo "postgresql-binaries checksum mismatch (expected $expected, got $actual)" >&2; exit 1; }; \
    mkdir -p /opt/postgresql; \
    tar -xzf /tmp/postgresql.tar.gz -C /opt/postgresql --strip-components=1; \
    for bin in pg_isready psql postgres initdb pg_ctl createdb dropdb; do \
      ln -s "/opt/postgresql/bin/$bin" "/usr/local/bin/$bin"; \
    done; \
    rm /tmp/postgresql.tar.gz /tmp/postgresql.sha256; \
    pg_isready --version; \
    initdb --version; \
    postgres --version

# Production node_modules + workspace manifests. The isolated-linker tree uses
# relative symlinks (store at node_modules/.bun), so copying the whole install
# root between same-rooted stages is safe. Kept BEFORE the source COPY so a
# source edit doesn't re-push this layer.
COPY --from=prod-deps /app/ /app/

# Scoped source closure (toolkit ships only as the compiled binary below).
COPY --parents \
  tsconfig.base.json \
  packages/temporal \
  packages/temporal-observability \
  packages/feature-flags \
  packages/code-review \
  packages/glitter-context \
  packages/home-assistant \
  packages/llm-models \
  packages/llm-observability \
  packages/s3-signed-request \
  packages/llm-runtime \
  packages/scout-for-lol/packages/data \
  packages/scout-for-lol/packages/temporal \
  packages/seaweedfs-backup \
  ./

# Built artifacts from the build stage.
COPY --from=build /app/packages/llm-models/dist packages/llm-models/dist
COPY --from=build /app/packages/glitter-context/dist packages/glitter-context/dist
COPY --from=build /app/packages/home-assistant/dist packages/home-assistant/dist
COPY --from=build /app/packages/scout-for-lol/packages/data/dist packages/scout-for-lol/packages/data/dist
COPY --from=build /usr/local/bin/toolkit /usr/local/bin/toolkit

# Verify the copied toolkit binary boots, then ensure the HA schema: the worker
# imports `#generated/ha-schema.ts` (type-only, but keep the file present so
# any runtime `import` resolves). ensure-ha-schema copies the committed stub
# into place if a generated schema isn't present. Idempotent, dependency-free —
# runs here because it writes into the source tree.
RUN toolkit --version \
    && bun packages/temporal/scripts/ensure-ha-schema.ts

ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION}
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# Point Bun's runtime install cache at a writable path — the runtime user may
# not be able to write the default root-owned cache location.
ENV BUN_INSTALL_CACHE_DIR=/tmp/bun-install-cache

# Run from the package dir so Bun resolves this package's tsconfig + imports map
# (the `#generated/*`, `#activities/*`, … subpath imports).
WORKDIR /app/packages/temporal
CMD ["bun", "src/worker.ts"]

FROM runtime AS smoke
# The smoke harness ships in CI context only — the scoped source COPY
# excludes .buildkite, so stage it here (never in the pushed image stage).
COPY .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts
COPY .buildkite/scripts/smoke-app-configs.ts /app/.buildkite/scripts/smoke-app-configs.ts
ARG SMOKE_TARGET=temporal-worker
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
# Smoke runs as the non-root deploy uid (1000, the app deployment convention),
# never root: a root smoke cannot see uid-1000-only failures — the Prisma
# engines EACCES crash-loop (#1682) passed root smoke and died in prod. HOME
# points at /tmp so any tool cache has a writable target.
USER 1000:1000
ENV HOME=/tmp
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts

FROM runtime AS image
