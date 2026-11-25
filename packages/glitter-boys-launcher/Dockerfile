# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
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

FROM rust-toolchain AS builder
WORKDIR /src
# The build context is this package (docker-bake.hcl target glitter-boys-launcher).
COPY . ./
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=sccache-rust,target=/var/cache/sccache,sharing=shared \
    cargo build --release --locked --package glitter-boys-service \
    && sccache --show-stats

FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime
COPY --from=builder /src/target/release/glitter-boys-service /usr/local/bin/glitter-boys-service
COPY --from=builder /etc/ssl/certs/ /etc/ssl/certs/
USER 1000:1000
EXPOSE 8080 9091
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
CMD ["/usr/local/bin/glitter-boys-service"]

FROM runtime AS smoke
RUN /usr/local/bin/glitter-boys-service --smoke

FROM runtime AS image
