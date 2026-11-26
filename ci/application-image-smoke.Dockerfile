# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a

# This stage starts from the exact registry digest that CI just pushed. It
# deliberately does not inherit a package Dockerfile stage: resolving the
# published manifest, rootfs, runtime config, and deploy user is the behavior
# under test.
# `scratch` keeps static Dockerfile checks valid; an invocation that forgets
# the required candidate argument still fails at the first RUN instruction.
ARG CANDIDATE_IMAGE=scratch

# Pure-Rust debian:trixie-slim application images (e.g. charts, ci-cache) ship
# no Bun runtime in production. Stage a standalone Bun binary only inside this
# ephemeral smoke harness so `smoke-app-in-image.ts` runs identically across all
# candidate images.
FROM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643 AS bun-harness

FROM ${CANDIDATE_IMAGE}

ARG SMOKE_TARGET
ARG EXPECTED_CONTRACT_HASH

USER 0:0
COPY --from=bun-harness --chown=1000:1000 --chmod=0755 \
  /usr/local/bin/bun \
  /tmp/smoke-bun
COPY --chown=1000:1000 \
  ci/scripts/images/smoke-app-in-image.ts \
  /app/ci/scripts/images/

# Scout and Media production images deliberately exclude PostgreSQL. Their
# exact-digest smokes start ephemeral databases to exercise deployed migrations,
# so install that harness-only dependency before switching to the deployment
# uid.
# Unpinned on purpose: Debian/Ubuntu drop superseded point releases from the
# archive, so an exact `pkg=version` pin turns every upstream security respin
# into a build failure here. Reproducibility would need a snapshot archive, not
# a version pin. Acknowledged per-site so a NEW unpinned install still fails.
# hadolint ignore=DL3008
RUN case "${SMOKE_TARGET}" in \
      scout-for-lol|media) \
        apt-get update \
        && apt-get install -y --no-install-recommends postgresql postgresql-client \
        && rm -rf /var/lib/apt/lists/* \
        ;; \
    esac

ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
ENV EXPECTED_CONTRACT_HASH=${EXPECTED_CONTRACT_HASH}
ENV HOME=/tmp
USER 1000:1000
RUN sh -c 'exec "$(command -v bun || echo /tmp/smoke-bun)" /app/ci/scripts/images/smoke-app-in-image.ts'
