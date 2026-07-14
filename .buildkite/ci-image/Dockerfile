# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuild when .mise.toml changes (the
# pipeline's build-ci-image step keys its registry cache on it); no VERSION
# file, no commit-back dance — the image tag is the .mise.toml content hash.
#
# swiftlint comes from realm's image (it bundles the Swift runtime libs the
# binary needs); everything else is mise-managed.

FROM ghcr.io/realm/swiftlint:0.61.0 AS swiftlint

FROM debian:bookworm-slim

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates curl git unzip xz-utils zstd python3 ripgrep \
    build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx for image-build steps (BuildKit runs in-pod)
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:0.30 /buildx /usr/local/lib/docker/cli-plugins/docker-buildx

# swiftlint + its bundled Swift runtime
COPY --from=swiftlint /usr/bin/swiftlint /usr/bin/swiftlint
COPY --from=swiftlint /usr/lib/swift/linux /usr/lib/swift/linux
ENV LD_LIBRARY_PATH=/usr/lib/swift/linux

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

CMD ["bash"]
