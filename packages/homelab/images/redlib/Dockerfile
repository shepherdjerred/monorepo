# redlib, built from upstream's glibc `Dockerfile.ubuntu` at a pinned commit.
#
# We build redlib from source ourselves rather than pulling the published image:
# upstream only publishes a musl/Alpine image whose TLS fingerprint Reddit now
# blocks during OAuth ("Failed to create OAuth client: 401 Unauthorized",
# redlib-org/redlib#551). The glibc Dockerfile.ubuntu build is unaffected.
#
# The old Dagger recipe (buildRedlibImageHelper) built upstream's own
# Dockerfile.ubuntu directly from the pinned git tree. This wrapper reproduces
# that faithfully for `docker buildx build`: it clones redlib at the exact pin
# and runs the same build steps that upstream's Dockerfile.ubuntu performs
# (builder: rust:slim-bookworm → cargo build --release --locked --bin redlib;
# release: ubuntu:noble with a non-root user, EXPOSE 8080, /settings
# healthcheck). Keeping the clone here means we track the pin without vendoring
# upstream's entire source tree into this repo.
#
# The pin advances via Renovate's git-refs custom manager (see renovate.json —
# REDLIB_SOURCE_REF); upstream's last tagged release predates the OAuth
# fingerprint fixes on `main`, so we pin main's HEAD commit.

########################
## builder image
########################
# Matches upstream Dockerfile.ubuntu's RUST_BUILDER_VERSION=slim-bookworm.
# renovate: datasource=docker depName=rust
FROM rust:slim-bookworm@sha256:fce20672592cce86737723a62b080aa59896e09e452ab1876fd9e990eaa80e5f AS builder

RUN apt-get update \
  && apt-get -y install --no-install-recommends git ca-certificates build-essential cmake libclang-dev \
  && rm -rf /var/lib/apt/lists/*

# Pinned redlib commit. Advanced by Renovate's git-refs manager (renovate.json).
# renovate: datasource=git-refs depName=redlib-source branch=main
ARG REDLIB_SOURCE_REF=a4d36e954cf1bd64f209cd8868c5a29edc81b374

WORKDIR /redlib
RUN set -e \
  && git init -q . \
  && git remote add origin https://github.com/redlib-org/redlib.git \
  && git fetch -q --depth 1 origin "${REDLIB_SOURCE_REF}" \
  && git checkout -q FETCH_HEAD

# Build the redlib binary (mirrors upstream's `cargo build --release --locked`).
RUN cargo build --release --locked --bin redlib \
  && echo "finished building redlib!"

########################
## release image
########################
# Matches upstream Dockerfile.ubuntu's UBUNTU_RELEASE_VERSION=noble.
# renovate: datasource=docker depName=ubuntu
FROM ubuntu:noble@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90 AS release

# Import redlib binary from builder.
COPY --from=builder /redlib/target/release/redlib /usr/local/bin/redlib

# Non-root user for running redlib (mirrors upstream).
RUN useradd \
  --no-create-home \
  --password "!" \
  --comment "user for running redlib" \
  redlib
USER redlib

EXPOSE 8080

# Healthcheck every minute to confirm redlib is functional (mirrors upstream).
HEALTHCHECK --interval=1m --timeout=3s CMD wget --spider -q http://localhost:8080/settings || exit 1

LABEL org.opencontainers.image.source="https://github.com/redlib-org/redlib"
LABEL org.opencontainers.image.revision.redlib="a4d36e954cf1bd64f209cd8868c5a29edc81b374"

CMD ["redlib"]
