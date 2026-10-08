# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
WORKDIR /app
COPY --parents package.json bun.lock bunfig.toml patches/ scripts/package.json packages/*/package.json packages/*/packages/*/package.json packages/docs/wiki/package.json packages/homelab/src/cdk8s/package.json packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/storm-forum'
COPY packages/storm-theme /app/packages/storm-theme
RUN bun /app/packages/storm-theme/scripts/generate.ts --check && bun build /app/packages/storm-theme/src/browser.ts --target browser --minify --outdir /app/packages/storm-theme/dist

FROM php:8.5.11-fpm-bookworm@sha256:dd198c828c224e479bdaa184cdcf04a28c73d186bf5a885493bf9cc78d7196ef AS runtime
# Distribution packages receive security updates when the pinned base is rebuilt.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends libfreetype6-dev libjpeg62-turbo-dev libpng-dev libzip-dev libicu-dev unzip mariadb-client ca-certificates \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j2 gd mysqli zip intl exif \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/forum /var/lib/storm-forum /tmp/storm-forum \
    && chown -R 1000:1000 /app /var/lib/storm-forum /tmp/storm-forum
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun /app/node_modules /app/node_modules
COPY --from=bun /app/packages /app/packages
COPY packages/config/src /app/packages/config/src
COPY packages/feature-flags/src /app/packages/feature-flags/src
COPY packages/storm-forum /opt/storm-forum
RUN ln -s /app/packages/storm-forum/node_modules /opt/storm-forum/node_modules \
    && ln -s /app/packages/storm-theme /opt/storm-theme
COPY packages/storm-forum/runtime/php.ini /usr/local/etc/php/conf.d/storm.ini
COPY packages/storm-forum/runtime/fpm.conf /usr/local/etc/php-fpm.conf
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" \
      org.opencontainers.image.version=$VERSION org.opencontainers.image.revision=$GIT_SHA
WORKDIR /opt/storm-forum
USER 1000:1000
CMD ["php-fpm", "--nodaemonize", "--force-stderr", "--fpm-config", "/usr/local/etc/php-fpm.conf"]

FROM runtime AS smoke
RUN bun scripts/runtime-smoke.ts

FROM runtime AS image
