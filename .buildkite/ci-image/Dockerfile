# CI base image: minimal host with Dagger CLI + Bun for pipeline generation.
# All heavy lifting (builds, tests, lints) runs inside Dagger containers.
# Version is tracked in .buildkite/ci-image/VERSION — bump it when changing this file.
# Build: docker build -t ghcr.io/shepherdjerred/ci-base:$(cat .buildkite/ci-image/VERSION) .buildkite/ci-image/
# Push:  docker push ghcr.io/shepherdjerred/ci-base:$(cat .buildkite/ci-image/VERSION)

# renovate: datasource=docker depName=oven/bun versioning=docker
FROM oven/bun:debian@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7

LABEL org.opencontainers.image.title="ci-base"
LABEL org.opencontainers.image.description="Minimal CI base image: Dagger CLI, Bun, Node.js, uv"
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# System essentials only
RUN apt-get update -qq && \
    apt-get install -y -qq \
    bash curl jq git ca-certificates unzip xz-utils && \
    rm -rf /var/lib/apt/lists/*

# Node.js (required by Dagger TypeScript SDK runtime)
# renovate: datasource=node-version depName=node
ARG NODE_VERSION=24.14.1
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | tar xJ -C /usr/local --strip-components=1

# renovate: datasource=github-releases depName=dagger/dagger
ARG DAGGER_VERSION=0.20.3
RUN curl -fsSL "https://dl.dagger.io/dagger/releases/${DAGGER_VERSION}/dagger_v${DAGGER_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C /usr/local/bin dagger && \
    chmod +x /usr/local/bin/dagger

# renovate: datasource=github-releases depName=astral-sh/uv
ARG UV_VERSION=0.11.3
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx || true
ENV UV_LINK_MODE=copy
