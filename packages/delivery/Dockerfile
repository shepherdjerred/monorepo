# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

FROM base AS deps
COPY --parents package.json bun.lock bunfig.toml patches/ scripts/package.json packages/*/package.json packages/*/packages/*/package.json packages/docs/wiki/package.json packages/homelab/src/cdk8s/package.json packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/delivery'

FROM deps AS build
COPY --parents tsconfig.base.json packages/delivery packages/config packages/feature-flags packages/ops-model packages/eslint-config ./
RUN cd packages/delivery && bun run generate && bun run build

FROM base AS prod-deps
COPY --parents package.json bun.lock bunfig.toml patches/ scripts/package.json packages/*/package.json packages/*/packages/*/package.json packages/docs/wiki/package.json packages/homelab/src/cdk8s/package.json packages/homelab/src/helm-types/package.json ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/delivery'

FROM base AS runtime
COPY --from=prod-deps /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/delivery /app/packages/delivery
COPY --parents packages/config packages/feature-flags packages/ops-model ./
RUN cd packages/delivery && bunx --no-install --trust prisma generate
WORKDIR /app/packages/delivery
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7353
USER 1000:1000
CMD ["bun", "src/server/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
COPY ci/scripts/images/smoke-app-configs.ts /app/ci/scripts/images/smoke-app-configs.ts
ARG SMOKE_TARGET=delivery
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bunx --no-install prisma --version && bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
