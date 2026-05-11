# CI base image: minimal host with Dagger CLI + Bun for pipeline generation.
# All heavy lifting (builds, tests, lints) runs inside Dagger containers.
# Version is tracked in .buildkite/ci-image/VERSION — bump it when changing this file.
# Build: docker build -t ghcr.io/shepherdjerred/ci-base:$(cat .buildkite/ci-image/VERSION) .buildkite/ci-image/
# Push:  docker push ghcr.io/shepherdjerred/ci-base:$(cat .buildkite/ci-image/VERSION)
#
# Tool versions intentionally mirror those in .buildkite/scripts/setup-tools.sh —
# install_*() functions there short-circuit via `command -v X && return` once a
# tool is in $PATH, so adding tools here makes the runtime install a no-op and
# eliminates per-pod overlay-layer writes (~2 GB/pod) that were thermally
# throttling nvme0n1.

# renovate: datasource=docker depName=oven/bun versioning=docker
FROM oven/bun:debian@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e

LABEL org.opencontainers.image.title="ci-base"
LABEL org.opencontainers.image.description="CI base image: Dagger CLI, Bun, Node.js, uv, semgrep, gh, helm, opentofu, awscli, ripgrep, shellcheck, gitleaks, trivy, plus build-essentials"
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

# System essentials + build dependencies (covers install_base() in setup-tools.sh)
RUN apt-get update -qq && \
    apt-get install -y -qq \
    bash curl jq git ca-certificates unzip xz-utils \
    gcc g++ python3 libssl-dev pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Node.js (required by Dagger TypeScript SDK runtime)
# renovate: datasource=node-version depName=node
ARG NODE_VERSION=24.15.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | tar xJ -C /usr/local --strip-components=1

# renovate: datasource=github-releases depName=dagger/dagger
ARG DAGGER_VERSION=0.20.6
RUN curl -fsSL "https://dl.dagger.io/dagger/releases/${DAGGER_VERSION}/dagger_v${DAGGER_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C /usr/local/bin dagger && \
    chmod +x /usr/local/bin/dagger

# renovate: datasource=github-releases depName=astral-sh/uv
ARG UV_VERSION=0.11.7
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx || true
ENV UV_LINK_MODE=copy

# semgrep via uv (covers install_semgrep() — the largest single per-pod writer
# at ~835 MB to /root/.local/share/uv + /root/.cache/uv)
# renovate: datasource=pypi depName=semgrep
ARG SEMGREP_VERSION=1.161.0
RUN uv tool install --python 3.12 "semgrep==${SEMGREP_VERSION}" --with setuptools
ENV PATH="/root/.local/bin:${PATH}"

# GitHub CLI (covers install_gh())
# renovate: datasource=github-releases depName=cli/cli
ARG GH_VERSION=2.91.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" | tar xz -C /tmp && \
    cp "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh && \
    chmod +x /usr/local/bin/gh && \
    rm -rf /tmp/gh_*

# Helm (covers install_helm())
# renovate: datasource=github-releases depName=helm/helm
ARG HELM_VERSION=v4.1.4
RUN curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" | tar xz -C /tmp && \
    mv /tmp/linux-amd64/helm /usr/local/bin/helm && \
    chmod +x /usr/local/bin/helm && \
    rm -rf /tmp/linux-amd64

# OpenTofu (covers install_tofu())
# renovate: datasource=github-releases depName=opentofu/opentofu
ARG OPENTOFU_VERSION=1.11.6
RUN curl -fsSL https://get.opentofu.org/install-opentofu.sh | \
    bash -s -- --install-method standalone --opentofu-version "${OPENTOFU_VERSION}"

# AWS CLI (covers install_awscli())
# renovate: datasource=github-tags depName=aws/aws-cli versioning=semver
ARG AWSCLI_VERSION=2.34.35
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWSCLI_VERSION}.zip" -o /tmp/awscliv2.zip && \
    unzip -q /tmp/awscliv2.zip -d /tmp/aws-install && \
    /tmp/aws-install/aws/install && \
    rm -rf /tmp/awscliv2.zip /tmp/aws-install

# ripgrep (covers install_ripgrep())
# renovate: datasource=github-releases depName=BurntSushi/ripgrep
ARG RIPGREP_VERSION=15.1.0
RUN curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp && \
    cp "/tmp/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl/rg" /usr/local/bin/rg && \
    chmod +x /usr/local/bin/rg && \
    rm -rf /tmp/ripgrep-*

# shellcheck (covers install_shellcheck())
# renovate: datasource=github-releases depName=koalaman/shellcheck
ARG SHELLCHECK_VERSION=0.11.0
RUN curl -fsSL "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz" | tar xJ -C /tmp && \
    cp "/tmp/shellcheck-v${SHELLCHECK_VERSION}/shellcheck" /usr/local/bin/shellcheck && \
    chmod +x /usr/local/bin/shellcheck && \
    rm -rf /tmp/shellcheck-*

# gitleaks (covers install_gitleaks())
# renovate: datasource=github-releases depName=gitleaks/gitleaks
ARG GITLEAKS_VERSION=8.30.1
RUN curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar xz -C /tmp && \
    cp /tmp/gitleaks /usr/local/bin/gitleaks && \
    chmod +x /usr/local/bin/gitleaks && \
    rm -f /tmp/LICENSE /tmp/README.md /tmp/gitleaks

# trivy (covers install_trivy())
# renovate: datasource=github-releases depName=aquasecurity/trivy
ARG TRIVY_VERSION=0.70.0
RUN curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" | tar xz -C /tmp && \
    cp /tmp/trivy /usr/local/bin/trivy && \
    chmod +x /usr/local/bin/trivy && \
    rm -f /tmp/LICENSE /tmp/README.md /tmp/trivy
