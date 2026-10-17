# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

FROM base AS deps
COPY --parents package.json bun.lock bunfig.toml patches/ scripts/package.json packages/*/package.json packages/*/packages/*/package.json packages/docs/wiki/package.json packages/homelab/src/cdk8s/package.json packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/media'

FROM deps AS build
COPY --parents tsconfig.base.json packages/media packages/config packages/feature-flags packages/eslint-config ./
RUN cd packages/media && bun run generate && bun run build

FROM base AS prod-deps
COPY --parents package.json bun.lock bunfig.toml patches/ scripts/package.json packages/*/package.json packages/*/packages/*/package.json packages/docs/wiki/package.json packages/homelab/src/cdk8s/package.json packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/media'

FROM base AS runtime
COPY --from=prod-deps /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/media /app/packages/media
COPY --parents packages/config packages/feature-flags ./
WORKDIR /app/packages/media
RUN bunx --no-install --trust prisma generate
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7352
USER 1000:1000
CMD ["bun", "src/server/index.ts"]

# The smoke stage boots the real API against a disposable migrated PostgreSQL
# cluster. These database tools never enter the final application image.
FROM runtime AS smoke
USER 0:0
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# Debian security updates replace package versions; the application runtime is
# inherited unchanged and the database tools exist only in this test stage.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libxml2 && rm -rf /var/lib/apt/lists/*
# renovate: datasource=github-releases depName=theseus-rs/postgresql-binaries
ARG POSTGRESQL_BINARIES_VERSION=18.6.0
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) pgarch=x86_64 ;; arm64) pgarch=aarch64 ;; *) exit 1 ;; esac; \
    base="https://github.com/theseus-rs/postgresql-binaries/releases/download/${POSTGRESQL_BINARIES_VERSION}"; \
    tarball="postgresql-${POSTGRESQL_BINARIES_VERSION}-${pgarch}-unknown-linux-gnu.tar.gz"; \
    curl -fsSL "$base/$tarball" -o /tmp/postgresql.tar.gz; \
    curl -fsSL "$base/$tarball.sha256" -o /tmp/postgresql.sha256; \
    expected="$(awk '{print $1}' /tmp/postgresql.sha256)"; \
    actual="$(sha256sum /tmp/postgresql.tar.gz | awk '{print $1}')"; \
    test -n "$expected"; test "$expected" = "$actual"; \
    mkdir -p /opt/postgresql; \
    tar -xzf /tmp/postgresql.tar.gz -C /opt/postgresql --strip-components=1; \
    rm /tmp/postgresql.tar.gz /tmp/postgresql.sha256
ENV PATH="/opt/postgresql/bin:${PATH}"
USER 1000:1000
RUN bun scripts/image-smoke.ts

FROM runtime AS image
