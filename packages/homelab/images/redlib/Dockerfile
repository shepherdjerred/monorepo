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
# release: Ubuntu 26.04 with a non-root user, EXPOSE 8080, /settings
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
FROM rust:slim-bookworm@sha256:94e9efa4033213dbb70d4f665527e7ece3944ddb7ba1dd2e43f6fd6e2490af58 AS builder

# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
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
# Renovate-managed Ubuntu 26.04 release base.
# renovate: datasource=docker depName=ubuntu
FROM ubuntu:26.04@sha256:2260313b31c8c011cd2eebe728008efac1b3982be73eb71348ea2648d2c0e09b AS release

# wget powers both the HEALTHCHECK below and the in-image `smoke` stage's
# /settings probe. The minimal Ubuntu image does not ship wget, so install it
# (upstream's Dockerfile.ubuntu relies on the base having a probe tool; the base
# image does not). Without this the smoke solve fails with `wget: not found`.
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get -y install --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/*

# Import redlib binary from builder.
COPY --from=builder /redlib/target/release/redlib /usr/local/bin/redlib

# Non-root user for running redlib (mirrors upstream). The uid/gid are pinned
# so the USER instruction below can be numeric — a numeric USER is resolvable
# by the container runtime and by Kubernetes runAsNonRoot admission without a
# passwd lookup. 1001 because Ubuntu's base image already owns 1000 (`ubuntu`).
RUN groupadd --gid 1001 redlib \
  && useradd \
  --uid 1001 \
  --gid 1001 \
  --no-create-home \
  --password "!" \
  --comment "user for running redlib" \
  redlib
USER 1001:1001

EXPOSE 8080

# Healthcheck every minute to confirm redlib is functional (mirrors upstream).
# Exec form (DL3025) with an explicit shell: the `|| exit 1` normalizes wget's
# 1–8 exit codes to 1, since HEALTHCHECK reserves codes other than 0/1.
HEALTHCHECK --interval=1m --timeout=3s CMD ["/bin/sh", "-c", "wget --spider -q http://localhost:8080/settings || exit 1"]

LABEL org.opencontainers.image.source="https://github.com/redlib-org/redlib"
LABEL org.opencontainers.image.revision.redlib="a4d36e954cf1bd64f209cd8868c5a29edc81b374"

CMD ["redlib"]

FROM release AS smoke
# DL3001 flags `kill` as a non-container command, but this smoke stage manages
# its own backgrounded redlib process, which is exactly what kill is for here.
# hadolint ignore=DL3001
RUN redlib >/tmp/redlib-smoke.log 2>&1 & \
  pid=$!; \
  cleanup_status=0; \
  trap 'if kill -0 $pid; then kill $pid; if wait $pid; then :; else cleanup_status=$?; [ $cleanup_status -eq 143 ] || exit $cleanup_status; fi; fi' EXIT; \
  for _ in $(seq 1 30); do \
    if wget --spider -q http://127.0.0.1:8080/settings; then exit 0; fi; \
    if ! kill -0 $pid; then cat /tmp/redlib-smoke.log; exit 1; fi; \
    sleep 1; \
  done; \
  cat /tmp/redlib-smoke.log; \
  exit 1

FROM release AS image
