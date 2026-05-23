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
# Caddyfile injected at runtime via ConfigMap mount → /etc/caddy/Caddyfile
EXPOSE 80
