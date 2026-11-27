# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a

# This stage starts from the exact registry digest that CI just pushed. It
# deliberately does not inherit a package Dockerfile stage: resolving the
# published manifest, rootfs, runtime config, and deploy user is the behavior
# under test.
# `scratch` keeps static Dockerfile checks valid; an invocation that forgets
# the required candidate argument still fails at the first RUN instruction.
ARG CANDIDATE_IMAGE=scratch

# Pure-Rust debian:trixie-slim application images (e.g. charts, ci-cache) ship
# no Bun runtime in production. Bind-mount a standalone Bun binary into the
# smoke RUN only, so `smoke-app-in-image.ts` runs identically across all
# candidate images without committing a ~100 MB harness layer on top of every
# candidate.
FROM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643 AS bun-harness

FROM ${CANDIDATE_IMAGE}

ARG SMOKE_TARGET
ARG EXPECTED_CONTRACT_HASH

USER 0:0

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
# The harness binary and script are read-only bind mounts: they exist only for
# this RUN and never become candidate-image layers.
RUN --mount=type=bind,from=bun-harness,source=/usr/local/bin/bun,target=/tmp/smoke-bun \
    --mount=type=bind,source=ci/scripts/images/smoke-app-in-image.ts,target=/app/ci/scripts/images/smoke-app-in-image.ts \
    sh -c 'exec "$(command -v bun || echo /tmp/smoke-bun)" /app/ci/scripts/images/smoke-app-in-image.ts'
