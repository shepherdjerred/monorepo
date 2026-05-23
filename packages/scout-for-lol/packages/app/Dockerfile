# Build the SPA, then serve it (plus reverse-proxy /trpc + /api to the
# backend) with Caddy. The Caddyfile is mounted at runtime via ConfigMap
# so we don't have to rebuild the image to change routing.

FROM oven/bun:1.3 AS build
WORKDIR /work
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM caddy:2.10-alpine
COPY --from=build /work/dist /var/www/app
# Caddyfile injected at runtime via ConfigMap mount → /etc/caddy/Caddyfile.
# /data and /config are emptyDir volumes injected by k8s at runtime (the
# pod runs as 1000/1000 per scout/app.ts) — Caddy needs to be able to
# write there.
RUN addgroup -g 1000 scout && \
    adduser -D -u 1000 -G scout scout && \
    chown -R 1000:1000 /var/www/app
USER 1000
EXPOSE 80
