FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/lindenlab/caddy-s3-proxy

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
LABEL org.opencontainers.image.source=https://github.com/shepherdjerred/monorepo
