# CI base image: oven/bun:debian + all tools pre-installed.
# Version is tracked in .buildkite/ci-image/VERSION — bump it when changing this file.
# Build: docker build -t ghcr.io/shepherdjerred/ci-base:$(cat .buildkite/ci-image/VERSION) .buildkite/ci-image/
# Push:  docker push ghcr.io/shepherdjerred/ci-base:$(cat .buildkite/ci-image/VERSION)

FROM oven/bun:debian@sha256:b86c67b531d87b4db11470d9b2bd0c519b1976eee6fcd71634e73abfa6230d2e

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

# renovate: datasource=github-releases depName=bazelbuild/bazelisk
ARG BAZELISK_VERSION=1.28.1
RUN curl -fsSL "https://github.com/bazelbuild/bazelisk/releases/download/v${BAZELISK_VERSION}/bazelisk-linux-amd64" \
    -o /usr/local/bin/bazel && \
    chmod +x /usr/local/bin/bazel

# Pre-download the actual Bazel binary (avoid download on first run)
COPY .bazelversion /tmp/.bazelversion
RUN cd /tmp && USE_BAZEL_VERSION=$(tr -d '\r' < .bazelversion) bazel --version

# renovate: datasource=github-releases depName=bazel-contrib/target-determinator
ARG TARGET_DETERMINATOR_VERSION=0.32.0
RUN curl -fsSL "https://github.com/bazel-contrib/target-determinator/releases/download/v${TARGET_DETERMINATOR_VERSION}/target-determinator.linux.amd64" \
    -o /usr/local/bin/target-determinator && \
    chmod +x /usr/local/bin/target-determinator

# renovate: datasource=github-releases depName=BurntSushi/ripgrep
ARG RIPGREP_VERSION=14.1.1
RUN curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar xz -C /tmp && \
    cp /tmp/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl/rg /usr/local/bin/rg && \
    chmod +x /usr/local/bin/rg && \
    rm -rf /tmp/ripgrep-*

# renovate: datasource=github-releases depName=kubernetes/kubectl
ARG KUBECTL_VERSION=v1.34.1
RUN curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    -o /usr/local/bin/kubectl && \
    chmod +x /usr/local/bin/kubectl

# renovate: datasource=github-releases depName=astral-sh/uv
ARG UV_VERSION=0.6.9
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx || true
ENV UV_LINK_MODE=copy

# renovate: datasource=github-releases depName=cli/cli
ARG GH_VERSION=2.72.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C /tmp && \
    cp /tmp/gh_${GH_VERSION}_linux_amd64/bin/gh /usr/local/bin/gh && \
    chmod +x /usr/local/bin/gh && \
    rm -rf /tmp/gh_*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y -qq nodejs && \
    rm -rf /var/lib/apt/lists/*

# renovate: datasource=github-releases depName=helm/helm
ARG HELM_VERSION=v3.17.3
RUN curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
    | tar xz -C /tmp && \
    mv /tmp/linux-amd64/helm /usr/local/bin/helm && \
    chmod +x /usr/local/bin/helm && \
    rm -rf /tmp/linux-amd64

# renovate: datasource=github-tags depName=aws/aws-cli versioning=semver
ARG AWSCLI_VERSION=2.27.22
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWSCLI_VERSION}.zip" -o /tmp/awscliv2.zip && \
    unzip -q /tmp/awscliv2.zip -d /tmp && \
    /tmp/aws/install && \
    rm -rf /tmp/awscliv2.zip /tmp/aws

# renovate: datasource=github-releases depName=opentofu/opentofu
ARG OPENTOFU_VERSION=1.9.1
RUN curl -fsSL https://get.opentofu.org/install-opentofu.sh | bash -s -- --install-method standalone --opentofu-version ${OPENTOFU_VERSION}

# renovate: datasource=github-releases depName=rust-lang/rustup versioning=semver
ARG RUSTUP_VERSION=1.28.2
RUN curl -fsSL "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
    -o /tmp/rustup-init && chmod +x /tmp/rustup-init && /tmp/rustup-init -y && rm /tmp/rustup-init && \
    . /root/.cargo/env && \
    rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu
RUN apt-get update -qq && \
    apt-get install -y -qq gcc-aarch64-linux-gnu && \
    rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"
