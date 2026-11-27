# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuilt every main build via registry
# cache (near-free when unchanged); the toolchain layers invalidate on
# .mise.toml changes.

ARG SWIFTLINT_BUILDER_IMAGE=docker.io/library/swift:6.4.3-jammy@sha256:a76121ceda0315af40b7c15e71a8447248a318787b0d8b41b212a2812279542f

# Build against Jammy's older libc. The upstream 0.65.1 Linux executable
# requires GLIBC_2.38 and cannot execute on our Bookworm image (GLIBC_2.36).
# The compiler stays in this stage; only its declared runtime libraries leave it.
FROM ${SWIFTLINT_BUILDER_IMAGE} AS swiftlint-builder
ARG SWIFTLINT_BUILDER_IMAGE
WORKDIR /swiftlint-source
COPY ci/scripts/swiftlint/pins.json /swiftlint-input/pins.json
COPY ci/scripts/swiftlint/extract-source.py /swiftlint-input/extract-source.py
COPY ci/scripts/swiftlint/producer.py /swiftlint-input/producer.py
RUN python3 /swiftlint-input/producer.py prepare-source \
    && python3 /swiftlint-input/producer.py compile-source
COPY ci/scripts/swiftlint/runtime-libraries.txt /swiftlint-input/runtime-libraries.txt
RUN set -eu; \
    mkdir -p /swiftlint-output/opt/swiftlint/bin /swiftlint-output/opt/swiftlint/lib /swiftlint-output/opt/swiftlint/licenses; \
    cp .build/release/swiftlint /swiftlint-output/opt/swiftlint/bin/swiftlint; \
    cp LICENSE /swiftlint-output/opt/swiftlint/licenses/SwiftLint-LICENSE; \
    cp /swiftlint-input/licenses/* /swiftlint-output/opt/swiftlint/licenses/; \
    while IFS= read -r runtime_library; do \
      cp -L "$runtime_library" /swiftlint-output/opt/swiftlint/lib/; \
    done < /swiftlint-input/runtime-libraries.txt
RUN python3 /swiftlint-input/producer.py collect-licenses

FROM debian:bookworm-slim@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e AS swiftlint-runtime
# hadolint ignore=DL3008
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates libcurl4 libxml2 libstdc++6 libgcc-s1 libatomic1 \
    zlib1g libtinfo6 libedit2 libsqlite3-0 libz3-4 python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=swiftlint-builder /swiftlint-output/ /
COPY ci/scripts/swiftlint/producer.py /swiftlint-input/producer.py
COPY ci/scripts/swiftlint/runtime.sh /opt/swiftlint/swiftlint
COPY ci/scripts/swiftlint/pins.json ci/scripts/swiftlint/verify-capabilities.sh /opt/swiftlint/contract/
COPY packages/tasknotes-macos/.swiftlint.yml packages/tasknotes-macos/.swiftlint-appkit-baseline.json /opt/swiftlint/contract/
RUN chmod 755 /opt/swiftlint/swiftlint \
    && ln -s /opt/swiftlint/swiftlint /usr/local/bin/swiftlint \
    && version="$(python3 -c 'import json; print(json.load(open("/opt/swiftlint/contract/pins.json"))["version"])')" \
    && bash /opt/swiftlint/contract/verify-capabilities.sh /usr/local/bin/swiftlint /opt/swiftlint/contract/.swiftlint.yml "$version"
RUN python3 /swiftlint-input/producer.py export-runtime

FROM scratch AS swiftlint-export
COPY --from=swiftlint-runtime /runtime.tar.gz /runtime.tar.gz.sha256 /runtime.manifest.json /

FROM debian:bookworm-slim@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e AS base

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
    build-essential pkg-config libssl-dev libxml2 libicu72 libcurl4 libatomic1 \
    libtinfo6 libedit2 libsqlite3-0 libz3-4 util-linux ffmpeg procps \
    && flock --version \
    && ffmpeg -version && ffprobe -version \
    && command -v ps \
    && rm -rf /var/lib/apt/lists/*
# BuildKit can still reach the plain-HTTP mirrors above, but Woodpecker step
# pods egress only on TCP 443. Switch apt to HTTPS now that ca-certificates is
# installed, and prove the switched sources resolve before the image ships.
RUN --mount=type=bind,source=ci/scripts/apt-https.sh,target=/tmp/apt-https.sh \
    bash /tmp/apt-https.sh \
    && apt-get update -qq \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx for image-build steps (BuildKit runs in-pod)
COPY --from=docker:29-cli@sha256:4e60c31615e83523afbb59773b25d055c0da9edcd5f80a4c6a6eebad49de1a25 /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:0.39.1@sha256:65035f720fc63f266620394a62edcde2318b3611ceb50b77af984578d011a0d6 /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

# Full configured SwiftLint, without retaining the compiler toolchain.
COPY --from=swiftlint-runtime /opt/swiftlint /opt/swiftlint
RUN ln -s /opt/swiftlint/swiftlint /usr/local/bin/swiftlint

# mise, pinned to the portable musl release assets; tools come from the
# repo's .mise.toml. Verify the release's signed checksum manifest so Renovate
# only needs to update the version and cannot leave architecture checksums stale.
# renovate: datasource=github-releases depName=jdx/mise
ARG MISE_VERSION=v2026.11.14
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

COPY .mise.toml mise.lock /workspace/
WORKDIR /workspace
# mise installs the URLs and checksums mise.lock records; --locked fails rather
# than resolving a tool the lockfile does not cover. The download credential
# is available only to this build step and is never stored in an image layer.
RUN --mount=type=secret,id=github-download-token,env=GITHUB_TOKEN,required=true \
    mise trust .mise.toml && mise install --locked && mise reshim \
    && ln -sf "$(mise which gh)" /usr/local/bin/gh \
    && gh --version \
    && ln -sf "$(mise which 7zz)" /usr/local/bin/7zz \
    && 7zz i

# Android build tools and NDK are published for Linux x86_64. Keep the ARM64
# base image usable for every other workspace; Android actions fail explicitly
# when invoked on that unsupported host architecture.
COPY ci/scripts/android-sdk.sh /workspace/ci/scripts/android-sdk.sh
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
RUN if [ "${TARGETARCH}" = amd64 ]; then bash ci/scripts/android-sdk.sh; \
    else echo "Android NDK provisioning omitted: Linux ARM64 host tools are unsupported"; fi

# uv/uvx for the python checks (ruff via uvx, pyright bootstraps a venv)
# renovate: datasource=pypi depName=uv
ARG UV_VERSION=0.13.10
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
