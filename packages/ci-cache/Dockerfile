# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS base
WORKDIR /app

# ── manifests: the install closure's manifests and projected lockfile ───────
FROM base AS manifests
COPY --parents \
  package.json bun.lock patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  /workspace/
COPY --parents \
  ci/scripts/images/workspace-manifests.ts \
  ci/scripts/images/install-projection/install-projection.ts \
  ci/scripts/selectors/select-image-targets-workspaces.ts \
  ci/scripts/selectors/select-image-targets-lockfile.ts \
  /tools/
RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure \
  '@shepherdjerred/ci-cache'

FROM base AS deps
COPY --parents bunfig.toml ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/ci-cache'

FROM deps AS client-build
COPY --parents \
  tsconfig.base.json \
  packages/ci-cache/package.json \
  packages/ci-cache/tsconfig.json \
  packages/ci-cache/vite.config.ts \
  packages/ci-cache/index.html \
  packages/ci-cache/client \
  packages/console-ui \
  packages/ops-model \
  ./
RUN cd packages/ci-cache && bunx vite build

# ── rust-toolchain: checksum-verified mozilla/sccache for amd64 & arm64 ─────
FROM rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c AS rust-toolchain
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG TARGETARCH
# renovate: datasource=github-releases depName=mozilla/sccache
ARG SCCACHE_VERSION=0.19.0
ARG SCCACHE_SHA256_AMD64=aa73c7270c997894038c0d8f0d297865f57569e1687883322bc431713d4bb9dd
ARG SCCACHE_SHA256_ARM64=3e47fc4a71b1ddd1b4294a0de9d34498922fdf41e3cd0bda5df3954e3d6deb9d
RUN set -eu; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
      amd64) triple="x86_64-unknown-linux-musl"; sha256="${SCCACHE_SHA256_AMD64}" ;; \
      arm64) triple="aarch64-unknown-linux-musl"; sha256="${SCCACHE_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    archive="sccache-v${SCCACHE_VERSION}-${triple}.tar.gz"; \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      "https://github.com/mozilla/sccache/releases/download/v${SCCACHE_VERSION}/${archive}" \
      -o "/tmp/${archive}"; \
    echo "${sha256}  /tmp/${archive}" | sha256sum -c -; \
    tar -xzf "/tmp/${archive}" -C /tmp; \
    install -D -m 0755 "/tmp/sccache-v${SCCACHE_VERSION}-${triple}/sccache" /usr/local/bin/sccache; \
    rm -rf "/tmp/${archive}" "/tmp/sccache-v${SCCACHE_VERSION}-${triple}"
ENV RUSTC_WRAPPER=/usr/local/bin/sccache \
    CC="/usr/local/bin/sccache cc" \
    CXX="/usr/local/bin/sccache c++" \
    CARGO_INCREMENTAL=0 \
    SCCACHE_DIR=/var/cache/sccache

FROM rust-toolchain AS rust-build
WORKDIR /src
COPY packages/ci-cache/Cargo.toml packages/ci-cache/Cargo.lock ./
COPY packages/ci-cache/src ./src
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=sccache-rust,target=/var/cache/sccache,sharing=shared \
    cargo build --release --locked --bin ci-cache \
    && sccache --show-stats

FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime
COPY --from=rust-build /src/target/release/ci-cache /usr/local/bin/ci-cache
COPY --from=rust-build /etc/ssl/certs/ /etc/ssl/certs/
COPY --from=client-build /app/packages/ci-cache/dist/client /usr/share/ci-cache/client
ARG VERSION=dev
ENV VERSION=${VERSION} \
    CI_CACHE_STATIC_DIR=/usr/share/ci-cache/client \
    CI_CACHE_DATA_DIR=/var/cache/ci-cache \
    PORT=7380 \
    HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7380
USER 1000:1000
CMD ["/usr/local/bin/ci-cache"]

FROM runtime AS smoke
RUN /usr/local/bin/ci-cache --smoke

FROM runtime AS image
