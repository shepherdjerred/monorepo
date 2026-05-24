# Build the SPA, then serve it (plus reverse-proxy /trpc + /api to the
# backend) with Caddy. The Caddyfile is mounted at runtime via ConfigMap
# so we don't have to rebuild the image to change routing.
#
# Build context: `packages/scout-for-lol/` (the scout workspace root).
# The SPA package depends on @scout-for-lol/backend (via file:../backend)
# for tRPC router types, so the lockfile + all workspace manifests must
# be present for bun install to succeed.
#
# Production builds normally go through Dagger (see .dagger/src/image.ts
# for the backend equivalent). This Dockerfile is kept so a one-off
# `docker build -f packages/scout-for-lol/packages/app/Dockerfile
# packages/scout-for-lol` still works for local validation.

FROM oven/bun:1.3@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build
WORKDIR /work

# Copy workspace manifests + lockfile so bun install can resolve every
# file: dep. Only the manifests up front to keep layer caching tight.
COPY package.json bun.lock bunfig.toml ./
COPY packages/app/package.json ./packages/app/
COPY packages/backend/package.json ./packages/backend/
COPY packages/data/package.json ./packages/data/

RUN bun install --frozen-lockfile

# Now bring in the source and build the SPA only.
COPY packages/app ./packages/app
COPY packages/data ./packages/data
COPY packages/backend ./packages/backend
RUN bun run --cwd packages/app build

FROM caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
COPY --from=build /work/packages/app/dist /var/www/app
# Caddyfile injected at runtime via ConfigMap mount → /etc/caddy/Caddyfile.
# /data and /config are emptyDir volumes injected by k8s at runtime (the
# pod runs as 1000/1000 per scout/app.ts) — Caddy needs to be able to
# write there.
RUN addgroup -g 1000 scout && \
    adduser -D -u 1000 -G scout scout && \
    chown -R 1000:1000 /var/www/app
USER 1000
EXPOSE 80
