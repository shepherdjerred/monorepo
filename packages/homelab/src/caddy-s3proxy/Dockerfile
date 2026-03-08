FROM caddy:2-builder-alpine@sha256:17a3a99c747d2124b9e9a6f434905b2869d67d9fc278b00f3deba5f4a69254bc AS builder
RUN xcaddy build --with github.com/lindenlab/caddy-s3-proxy

FROM caddy:2-alpine@sha256:fce4f15aad23222c0ac78a1220adf63bae7b94355d5ea28eee53910624acedfa
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
LABEL org.opencontainers.image.source=https://github.com/shepherdjerred/monorepo
