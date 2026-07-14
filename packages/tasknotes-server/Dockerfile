# tasknotes-server image. Build context is the REPO ROOT (single Bun workspace,
# one root bun.lock, isolated linker). Built via `bun run docker:build` in this
# package (which passes `-f Dockerfile ../..`).
FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Copy the whole workspace and install once at the root against the single
# lockfile. The root .dockerignore keeps node_modules/dist/.git out of context.
COPY . .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production

# tasknotes-server serves on PORT (default 3000) with no external auth at boot.
EXPOSE 3000

CMD ["bun", "packages/tasknotes-server/src/index.ts"]
