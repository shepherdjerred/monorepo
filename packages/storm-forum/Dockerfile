# syntax=docker/dockerfile:1-labs@sha256:36366b12c1dffb228bb25e9feffb73707b93388f084f4927d2b7686dba29e76a
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS base
WORKDIR /app

# ── manifests: the install closure's manifests and projected lockfile ───────
# Every manifest, bun.lock and patch reaches this cheap stage; installs copy only
# its output (the closure's manifests plus root package.json, bun.lock and
# patches projected onto the closure), so a change outside the closure keeps
# their cache keys and layers.
FROM base AS manifests
COPY --parents \
  package.json bun.lock patches/ scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  /workspace/
COPY --parents \
  ci/scripts/images/workspace-manifests.ts \
  ci/scripts/images/install-projection/install-projection.ts \
  ci/scripts/selectors/select-image-targets-workspaces.ts \
  ci/scripts/selectors/select-image-targets-lockfile.ts \
  /tools/
RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure \
  '@shepherdjerred/storm-forum'

FROM base AS bun
COPY --parents bunfig.toml ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/storm-forum'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun
COPY packages/storm-theme /app/packages/storm-theme
COPY packages/the-storm/public-status.json /app/packages/the-storm/public-status.json
RUN bun /app/packages/storm-theme/scripts/generate.ts --check && bun build /app/packages/storm-theme/src/browser.ts --target browser --minify --outdir /app/packages/storm-theme/dist

FROM php:8.5.13-fpm-bookworm@sha256:bad1d3498eaa489efe88c1d532e47e2f4111304c3f0b19fbc428842c39ec155c AS runtime
# Distribution packages receive security updates when the pinned base is rebuilt.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends libfreetype6-dev libjpeg62-turbo-dev libpng-dev libzip-dev libicu-dev unzip ca-certificates \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j2 gd mysqli zip intl exif \
    && rm -rf /var/lib/apt/lists/* /var/log/apt/* /var/log/dpkg.log /var/log/alternatives.log /var/cache/ldconfig/aux-cache \
    && mkdir -p /app/forum /var/lib/storm-forum /tmp/storm-forum \
    && chown -R 1000:1000 /app /var/lib/storm-forum /tmp/storm-forum
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun /app/node_modules /app/node_modules
COPY --from=bun /app/packages /app/packages
COPY packages/config/src /app/packages/config/src
COPY packages/feature-flags/src /app/packages/feature-flags/src
COPY packages/ops-model/src /app/packages/ops-model/src
COPY packages/storm-forum /opt/storm-forum
RUN ln -s /app/packages/storm-forum/node_modules /opt/storm-forum/node_modules \
    && ln -s /app/packages/storm-theme /opt/storm-theme
RUN bun build /opt/storm-forum/browser/minecraft.ts --target browser --minify --outfile /opt/storm-forum/dist/minecraft.js
COPY packages/storm-forum/runtime/php.ini /usr/local/etc/php/conf.d/storm.ini
COPY packages/storm-forum/runtime/fpm.conf /usr/local/etc/php-fpm.conf
# Build identity rides in ENV like every application image, where the release
# fingerprint excludes it; a label carrying it would make every rebuild of
# unchanged content look like a new artifact.
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION} GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" \
      red.sjer.delivery.forum-recovery="storm-forum-recovery/v1"
WORKDIR /opt/storm-forum
USER 1000:1000
CMD ["php-fpm", "--nodaemonize", "--force-stderr", "--fpm-config", "/usr/local/etc/php-fpm.conf"]

FROM runtime AS smoke
RUN bun scripts/runtime-smoke.ts

FROM runtime AS image
