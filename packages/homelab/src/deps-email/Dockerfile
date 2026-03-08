FROM alpine/helm:3.16.4@sha256:9b25e60ae264940b276e32866d37e3088e70c4e2d1784b964dc3f90346281a74 AS helm

FROM oven/bun:debian@sha256:b86c67b531d87b4db11470d9b2bd0c519b1976eee6fcd71634e73abfa6230d2e AS base
RUN apt-get update && apt-get install -y git build-essential python3 && rm -rf /var/lib/apt/lists/*
COPY --from=helm /usr/bin/helm /usr/local/bin/helm
WORKDIR /app
COPY package.json bun.lock ./
COPY patches/ patches/
COPY src/deps-email/package.json src/deps-email/
COPY src/cdk8s/package.json src/cdk8s/
COPY src/helm-types/package.json src/helm-types/
COPY src/ha/package.json src/ha/
RUN bun install --frozen-lockfile || bun install
COPY src/deps-email/ src/deps-email/
COPY src/cdk8s/ src/cdk8s/
COPY src/helm-types/ src/helm-types/
COPY src/ha/ src/ha/
WORKDIR /app/src/deps-email
LABEL org.opencontainers.image.source=https://github.com/shepherdjerred/monorepo
CMD ["bun", "run", "src/main.ts"]
