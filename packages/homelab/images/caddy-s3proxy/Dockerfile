# Custom Caddy with the S3 proxy plugin.
#
# Translated from the old Dagger recipe (buildCaddyS3ProxyImageHelper): a builder
# stage runs `xcaddy build` to compile a custom Caddy binary with the S3 proxy
# module, then the binary is copied into the runtime Caddy Alpine image.
#
# Uses shepherdjerred/caddy-s3-proxy as a drop-in for the upstream lindenlab
# module — keeps the import path so existing Caddyfiles work, but adds native
# HEAD support, fixes the 304-on-index regression, and returns 206 +
# Accept-Ranges on byte-range requests (Safari refuses to play video from
# origins that answer 200 to Range requests).

# renovate: datasource=docker depName=caddy
FROM caddy:2.11.4-builder-alpine@sha256:8e89605351333ad2cc2f3bcc95275a2ccc427f88914050e86a5fde0fd77a63c4 AS builder

# xcaddy --with module for the S3 proxy plugin. The fork keeps the upstream
# import path and adds HEAD support, the 304-on-index fix, and 206/Accept-Ranges
# on byte-range responses. Not managed by renovate — bump the tag when the fork
# changes.
RUN xcaddy build --with github.com/lindenlab/caddy-s3-proxy=github.com/shepherdjerred/caddy-s3-proxy@v0.5.7-head2

# renovate: datasource=docker depName=caddy
FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
