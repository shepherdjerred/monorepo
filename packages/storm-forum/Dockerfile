# syntax=docker/dockerfile:1-labs@sha256:63e440b412b6acba117974e793b7e7f702e58ee65e044bdff1b8d388ee0d853b
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
WORKDIR /app
COPY --parents package.json bun.lock bunfig.toml patches/ scripts/package.json packages/*/package.json packages/*/packages/*/package.json packages/docs/wiki/package.json packages/the-storm/brain/package.json packages/homelab/src/cdk8s/package.json packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/storm-forum'

FROM php:8.3.35-fpm-bookworm@sha256:536a1188a926efe7e6f927b7ca01f3a043c63d0a527567c6d4d3bf9fbd637866 AS runtime
# Distribution packages receive security updates when the pinned base is rebuilt.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends libfreetype6-dev libjpeg62-turbo-dev libpng-dev libzip-dev libicu-dev unzip mariadb-client ca-certificates \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j2 gd mysqli zip intl opcache exif \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/forum /var/lib/storm-forum /tmp/storm-forum \
    && chown -R 1000:1000 /app /var/lib/storm-forum /tmp/storm-forum
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun /app/node_modules /app/node_modules
COPY --from=bun /app/packages /app/packages
COPY packages/config/src /app/packages/config/src
COPY packages/feature-flags/src /app/packages/feature-flags/src
COPY packages/storm-forum /opt/storm-forum
RUN ln -s /app/packages/storm-forum/node_modules /opt/storm-forum/node_modules
COPY packages/ts-mc/public/logo.svg /opt/storm-forum/assets/logo.svg
COPY packages/storm-forum/runtime/php.ini /usr/local/etc/php/conf.d/storm.ini
COPY packages/storm-forum/runtime/fpm.conf /usr/local/etc/php-fpm.conf
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" \
      org.opencontainers.image.version=$VERSION org.opencontainers.image.revision=$GIT_SHA
WORKDIR /opt/storm-forum
USER 1000:1000
CMD ["php-fpm", "--fpm-config", "/usr/local/etc/php-fpm.conf"]

FROM runtime AS smoke
RUN bun scripts/runtime-smoke.ts

FROM runtime AS image
