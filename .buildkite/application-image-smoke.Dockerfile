# syntax=docker/dockerfile:1-labs@sha256:7d49dad25a050e14338ba7028b0460243f9d911dedc160a8fe20c34738fef3af

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
COPY --chown=1000:1000 .buildkite/scripts/smoke-app-in-image.ts /app/.buildkite/scripts/smoke-app-in-image.ts

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
