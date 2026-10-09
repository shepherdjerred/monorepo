# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuilt every main build via registry
# cache (near-free when unchanged); the toolchain layers invalidate on
# .mise.toml changes.

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS base

# Fail-fast shell for every RUN: a failing producer in a pipeline (curl | sh,
# printf | sha256sum) must fail the build, not be masked by the consumer.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git minisign unzip xz-utils zstd python3 ripgrep rsync \
    build-essential pkg-config libssl-dev libxml2 util-linux \
    && flock --version \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx for image-build steps (BuildKit runs in-pod)
COPY --from=docker:29-cli@sha256:1a4c7cb63513f349bdad01fcc6e0f3f2f67d37b9da86f14dc0d4a0942eecda00 /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:0.38.0@sha256:abcf2315937f37bdb52615d1698a4696e3952e88c440a07e7552cbefbc72b1b6 /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

# swiftlint from the official release zip: the -static build is
# self-contained (the dynamic binary needs Swift runtime libs neither the
# zip nor realm's image lays out where we can copy them). Same recipe as
# ci/scripts/toolchain.sh — keep the two in sync.
# renovate: datasource=github-releases depName=realm/SwiftLint
ARG SWIFTLINT_VERSION=0.61.0
RUN curl -fsSL "https://github.com/realm/SwiftLint/releases/download/${SWIFTLINT_VERSION}/swiftlint_linux_amd64.zip" -o /tmp/swiftlint.zip \
    && unzip -q -o /tmp/swiftlint.zip -d /usr/local/swiftlint \
    && ln -sf /usr/local/swiftlint/swiftlint-static /usr/local/bin/swiftlint \
    && rm /tmp/swiftlint.zip

# mise, pinned to the portable musl release assets; tools come from the
# repo's .mise.toml. Verify the release's signed checksum manifest so Renovate
# only needs to update the version and cannot leave architecture checksums stale.
# renovate: datasource=github-releases depName=jdx/mise
ARG MISE_VERSION=v2026.7.13
ARG MISE_MINISIGN_PUBLIC_KEY=RWTC3g8W3z4RZK3V3qv7fa1QY4JEWyBtqIHW+85QlJpZc5yG+uNYNBSZ
ARG TARGETARCH
ENV MISE_DATA_DIR=/opt/mise \
    PATH="/opt/mise/shims:/root/.local/bin:${PATH}"
RUN case "${TARGETARCH}" in \
        amd64) mise_arch=x64 ;; \
        arm64) mise_arch=arm64 ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && mise_asset="mise-${MISE_VERSION}-linux-${mise_arch}-musl.tar.xz" \
    && curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/${mise_asset}" -o "/tmp/${mise_asset}" \
    && curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/SHASUMS256.txt" -o /tmp/SHASUMS256.txt \
    && curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/SHASUMS256.txt.minisig" -o /tmp/SHASUMS256.txt.minisig \
    && minisign -V -P "${MISE_MINISIGN_PUBLIC_KEY}" -m /tmp/SHASUMS256.txt -x /tmp/SHASUMS256.txt.minisig \
    && cd /tmp \
    && checksum_line="$(grep -F "  ./${mise_asset}" SHASUMS256.txt)" \
    && printf '%s\n' "${checksum_line}" | sha256sum -c - \
    && tar -xJf "${mise_asset}" -C /usr/local/bin --strip-components=2 mise/bin/mise \
    && rm "${mise_asset}" SHASUMS256.txt SHASUMS256.txt.minisig \
    && mise --version

COPY .mise.toml /workspace/.mise.toml
WORKDIR /workspace
# mise resolves signed GitHub releases during install. The download credential
# is available only to this build step and is never stored in an image layer.
RUN --mount=type=secret,id=github-download-token,env=GITHUB_TOKEN,required=true \
    mise trust .mise.toml && mise install && mise reshim \
    && ln -sf "$(mise which gh)" /usr/local/bin/gh \
    && gh --version

# uv/uvx for the python checks (ruff via uvx, pyright bootstraps a venv)
# renovate: datasource=pypi depName=uv
ARG UV_VERSION=0.12.24
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh

# The bun download cache is NOT baked into this image anymore. The old
# bun-cache-warm stage added ~1 GiB compressed that re-pushed/re-pulled on
# every lockfile change; CI pods now share a persistent node-local cache
# volume instead (woodpecker-bun-cache PVC, mounted by the generated
# pipeline's Kubernetes backend options). The pipeline points
# BUN_INSTALL_CACHE_DIR at the
# mount's data subdirectory. Every install holds a shared lock while the
# threshold-based collector takes the exclusive lock before clearing the
# cache. The shared cache stays warm across builds without living in the image;
# if it's absent, Bun degrades gracefully to network fetches.

CMD ["bash"]
