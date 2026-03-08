FROM oven/bun:debian@sha256:b86c67b531d87b4db11470d9b2bd0c519b1976eee6fcd71634e73abfa6230d2e AS base
RUN apt-get update && apt-get install -y git build-essential python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY patches/ patches/
COPY src/ha/package.json src/ha/
COPY src/cdk8s/package.json src/cdk8s/
COPY src/helm-types/package.json src/helm-types/
COPY src/deps-email/package.json src/deps-email/
RUN bun install --frozen-lockfile || bun install
COPY src/ha/ src/ha/
COPY src/cdk8s/ src/cdk8s/
COPY src/helm-types/ src/helm-types/
COPY src/deps-email/ src/deps-email/
WORKDIR /app/src/ha
EXPOSE 9090
LABEL org.opencontainers.image.source=https://github.com/shepherdjerred/monorepo
CMD ["bun", "src/main.ts"]
