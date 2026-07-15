# CI toolchain image — baked from the repo's .mise.toml so agents run the
# EXACT tool versions developers run. Rebuild when .mise.toml changes (the
# pipeline's build-ci-image step keys its registry cache on it); no VERSION
# file, no commit-back dance — the image tag is the .mise.toml content hash.

FROM debian:bookworm-slim

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

CMD ["bash"]
