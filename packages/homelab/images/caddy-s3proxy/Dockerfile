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
# origins that answer 200 to Range requests). The pinned source is patched
# locally to flush Caddy's deferred response headers before streaming S3 data.

# renovate: datasource=docker depName=caddy
FROM caddy:2.11.4-builder-alpine@sha256:7bac9be4072f7c4db2ccc7350750e0705004bf02da2ac7d96b1469ca4f28bb7c AS builder

# xcaddy --with module for the S3 proxy plugin. The fork keeps the upstream
# import path and adds HEAD support, the 304-on-index fix, and 206/Accept-Ranges
# on byte-range responses. The source commit is pinned because the compatibility
# patch below must be applied to the exact tree it was reviewed against.
COPY caddy-s3proxy-header-flush.patch /tmp/caddy-s3proxy-header-flush.patch
RUN git init /tmp/caddy-s3-proxy \
  && git -C /tmp/caddy-s3-proxy remote add origin https://github.com/shepherdjerred/caddy-s3-proxy.git \
  && git -C /tmp/caddy-s3-proxy fetch --depth 1 origin 2333a6ed263df951a2a017ef248af8c97fbf8b42 \
  && git -C /tmp/caddy-s3-proxy checkout --detach FETCH_HEAD \
  && git -C /tmp/caddy-s3-proxy apply --unidiff-zero /tmp/caddy-s3proxy-header-flush.patch \
  && xcaddy build --with github.com/lindenlab/caddy-s3-proxy=/tmp/caddy-s3-proxy

# renovate: datasource=docker depName=caddy
FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS runtime

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

FROM runtime AS smoke
# Alpine base: busybox ash supports pipefail, so a failing `caddy list-modules`
# fails the smoke check instead of being masked by grep.
SHELL ["/bin/ash", "-o", "pipefail", "-c"]
RUN caddy version && caddy list-modules | grep -F "http.handlers.s3proxy"
RUN --mount=type=secret,id=caddyfile \
  caddy adapt --config /run/secrets/caddyfile --adapter caddyfile >/dev/null

FROM runtime AS image
