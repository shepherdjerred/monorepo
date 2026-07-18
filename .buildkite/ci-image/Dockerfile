# syntax=docker/dockerfile:1.7-labs
# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuilt every main build via registry
# cache (near-free when unchanged); the toolchain layers invalidate on
# .mise.toml changes and the bun-cache layer on manifest/lockfile changes.

FROM debian:bookworm-slim AS base

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git unzip xz-utils zstd python3 ripgrep rsync \
    build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx for image-build steps (BuildKit runs in-pod)
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:0.30.1 /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

# swiftlint from the official release zip: the -static build is
# self-contained (the dynamic binary needs Swift runtime libs neither the
# zip nor realm's image lays out where we can copy them). Same recipe as
# .buildkite/scripts/toolchain.sh — keep the two in sync.
# renovate: datasource=github-releases depName=realm/SwiftLint
ARG SWIFTLINT_VERSION=0.61.0
RUN curl -fsSL "https://github.com/realm/SwiftLint/releases/download/${SWIFTLINT_VERSION}/swiftlint_linux_amd64.zip" -o /tmp/swiftlint.zip \
    && unzip -q -o /tmp/swiftlint.zip -d /usr/local/swiftlint \
    && ln -sf /usr/local/swiftlint/swiftlint-static /usr/local/bin/swiftlint \
    && rm /tmp/swiftlint.zip

# mise, pinned; tools come from the repo's .mise.toml
ENV MISE_VERSION="v2026.7.1" \
    MISE_DATA_DIR=/opt/mise \
    PATH="/opt/mise/shims:/root/.local/bin:${PATH}"
RUN curl -fsSL https://mise.run | sh

COPY .mise.toml /workspace/.mise.toml
WORKDIR /workspace
RUN mise trust .mise.toml && mise install && mise reshim

# uv/uvx for the python checks (ruff via uvx, pyright bootstraps a venv)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# claude CLI for the release CHANGELOG-refinement step (scripts/release.ts);
# same pinned recipe as packages/birmel/Dockerfile.
ARG CLAUDE_CODE_VERSION=2.1.175
ENV BUN_INSTALL=/usr/local
RUN bun add -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && claude --version

# Throwaway stage: warm the bun download cache from the workspace manifests
# (same enumeration as the app images' install layer). Only /opt/bun-cache is
# copied into the final image — node_modules and the manifest tree are
# discarded. CI's per-step `bun install --frozen-lockfile` then resolves
# packages from local disk: measured 13s warm vs 25-72s network-cold, ~11-15
# installs per main build. A stale cache (lockfile changed since the last
# image push) degrades gracefully — bun fetches the delta from the network.
FROM base AS bun-cache-warm
ENV BUN_INSTALL_CACHE_DIR=/opt/bun-cache
COPY --parents \
  package.json bun.lock bunfig.toml patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  packages/scout-for-lol/packages/desktop/src-tauri/package.json \
  ./
RUN bun install --frozen-lockfile

FROM base
COPY --from=bun-cache-warm /opt/bun-cache /opt/bun-cache
ENV BUN_INSTALL_CACHE_DIR=/opt/bun-cache

CMD ["bash"]
