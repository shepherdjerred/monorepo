# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af
# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuilt every main build via registry
# cache (near-free when unchanged); the toolchain layers invalidate on
# .mise.toml changes.

FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818 AS base

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git unzip xz-utils zstd python3 ripgrep rsync \
    build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx for image-build steps (BuildKit runs in-pod)
COPY --from=docker:28-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:0.35.0@sha256:917570d8d0ae91ae49251f84f848a6801eedd114554c56a4fdf7ec88cac48eeb /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

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
# renovate: datasource=github-releases depName=jdx/mise
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
# renovate: datasource=npm depName=@anthropic-ai/claude-code
ARG CLAUDE_CODE_VERSION=2.1.175
ENV BUN_INSTALL=/usr/local
RUN bun add -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && claude --version

# The bun download cache is NOT baked into this image anymore. The old
# bun-cache-warm stage added ~1 GiB compressed that re-pushed/re-pulled on
# every lockfile change; CI pods now share a persistent node-local cache
# volume instead (buildkite-bun-cache PVC, mounted by the agent-stack
# pod-spec-patch in packages/homelab/src/cdk8s/src/resources/argo-applications/
# buildkite.ts, with BUN_INSTALL_CACHE_DIR pointing at the mount). The shared
# cache stays warm across builds without living in the image; if it's absent,
# bun degrades gracefully to network fetches.

CMD ["bash"]
