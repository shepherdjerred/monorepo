# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuilt every main build via registry
# cache (near-free when unchanged); the toolchain layers invalidate on
# .mise.toml changes.

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS base

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
COPY --from=docker:29-cli@sha256:000bb62ff495f986c9f5578eb67cc2cb98b91138eda81d7762d5371eb8a497fe /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:0.36.1@sha256:1f2f6b2be4a2511ada67336e76892f1a588c89746009dd4b21069e4d867465be /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

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
RUN mise trust .mise.toml && mise install && mise reshim \
    && ln -sf "$(mise which gh)" /usr/local/bin/gh \
    && gh --version

# uv/uvx for the python checks (ruff via uvx, pyright bootstraps a venv)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# The bun download cache is NOT baked into this image anymore. The old
# bun-cache-warm stage added ~1 GiB compressed that re-pushed/re-pulled on
# every lockfile change; CI pods now share a persistent node-local cache
# volume instead (buildkite-bun-cache PVC, mounted by the agent-stack
# pod-spec-patch in packages/homelab/src/cdk8s/src/resources/argo-applications/
# buildkite.ts). The static pipeline points BUN_INSTALL_CACHE_DIR at the
# mount's data subdirectory. Every install holds a shared lock while the
# threshold-based collector takes the exclusive lock before clearing the
# cache. The shared cache stays warm across builds without living in the image;
# if it's absent, Bun degrades gracefully to network fetches.

CMD ["bash"]
