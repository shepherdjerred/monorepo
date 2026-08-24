# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b

# This stage starts from the exact registry digest that CI just pushed. It
# deliberately does not inherit a package Dockerfile stage: resolving the
# published manifest, rootfs, runtime config, and deploy user is the behavior
# under test.
# `scratch` keeps static Dockerfile checks valid; an invocation that forgets
# the required candidate argument still fails at the first RUN instruction.
ARG CANDIDATE_IMAGE=scratch
FROM ${CANDIDATE_IMAGE}

ARG SMOKE_TARGET
ARG EXPECTED_CONTRACT_HASH

USER 0:0
COPY --chown=1000:1000 \
  .buildkite/scripts/smoke-app-in-image.ts \
  .buildkite/scripts/smoke-app-configs.ts \
  /app/.buildkite/scripts/

# Scout's production image deliberately excludes PostgreSQL. Its exact-digest
# smoke starts an ephemeral database to exercise the deployed migration path,
# so install that harness-only dependency before switching to the deployment
# uid.
RUN case "${SMOKE_TARGET}" in \
      scout-for-lol) \
        apt-get update \
        && apt-get install -y --no-install-recommends postgresql postgresql-client \
        && rm -rf /var/lib/apt/lists/* \
        ;; \
    esac

# These applications write their smoke config at the production working
# directory. Prepare only the writable file while root, then run every smoke
# as the deployment uid.
RUN case "${SMOKE_TARGET}" in \
      discord-plays-pokemon) \
        touch /app/packages/discord-plays-pokemon/config.toml \
        && chown 1000:1000 /app/packages/discord-plays-pokemon/config.toml \
        ;; \
      discord-plays-mario-kart) \
        touch /app/packages/discord-plays-mario-kart/config.toml \
        && chown 1000:1000 /app/packages/discord-plays-mario-kart/config.toml \
        ;; \
    esac

ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
ENV EXPECTED_CONTRACT_HASH=${EXPECTED_CONTRACT_HASH}
ENV HOME=/tmp
USER 1000:1000
RUN bun /app/.buildkite/scripts/smoke-app-in-image.ts
