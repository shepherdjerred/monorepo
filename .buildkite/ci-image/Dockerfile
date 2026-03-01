# CI base image: oven/bun:debian + all tools pre-installed.
# Build: docker build -t ghcr.io/shepherdjerred/ci-base:latest .buildkite/ci-image/
# Push:  docker push ghcr.io/shepherdjerred/ci-base:latest

FROM oven/bun:debian

LABEL org.opencontainers.image.title="ci-base"
LABEL org.opencontainers.image.description="CI base image with Bun and pre-installed build tools"
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# System dependencies
RUN apt-get update -qq && \
    apt-get install -y -qq \
    curl jq git ca-certificates unzip \
    gcc g++ python3 python3-pip \
    libssl-dev pkg-config gpg && \
    rm -rf /var/lib/apt/lists/*

# Bazelisk
ARG BAZELISK_VERSION=1.28.1
RUN curl -fsSL "https://github.com/bazelbuild/bazelisk/releases/download/v${BAZELISK_VERSION}/bazelisk-linux-amd64" \
    -o /usr/local/bin/bazel && \
    chmod +x /usr/local/bin/bazel

# Pre-download the actual Bazel binary (avoid download on first run)
COPY .bazelversion /tmp/.bazelversion
RUN cd /tmp && USE_BAZEL_VERSION=$(tr -d '\r' < .bazelversion) bazel --version

# target-determinator
ARG TARGET_DETERMINATOR_VERSION=0.32.0
RUN curl -fsSL "https://github.com/bazel-contrib/target-determinator/releases/download/v${TARGET_DETERMINATOR_VERSION}/target-determinator.linux.amd64" \
    -o /usr/local/bin/target-determinator && \
    chmod +x /usr/local/bin/target-determinator

# ripgrep
ARG RIPGREP_VERSION=14.1.1
RUN curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar xz -C /tmp && \
    cp /tmp/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl/rg /usr/local/bin/rg && \
    chmod +x /usr/local/bin/rg && \
    rm -rf /tmp/ripgrep-*

# kubectl
ARG KUBECTL_VERSION=v1.34.1
RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    -o /usr/local/bin/kubectl && \
    chmod +x /usr/local/bin/kubectl

# uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx || true
ENV UV_LINK_MODE=copy

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update -qq && apt-get install -y -qq gh && \
    rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y -qq nodejs && \
    rm -rf /var/lib/apt/lists/*

# Helm
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# AWS CLI
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip && \
    unzip -q /tmp/awscliv2.zip -d /tmp && \
    /tmp/aws/install && \
    rm -rf /tmp/awscliv2.zip /tmp/aws

# OpenTofu
RUN curl -fsSL https://get.opentofu.org/install-opentofu.sh | bash -s -- --install-method standalone

# Rust toolchain + cross-compilation targets
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
    . /root/.cargo/env && \
    rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu
RUN apt-get update -qq && \
    apt-get install -y -qq gcc-aarch64-linux-gnu && \
    rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"
