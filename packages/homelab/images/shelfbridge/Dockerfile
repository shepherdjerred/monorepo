# shelfbridge, built from upstream at a pinned commit.
#
# We build shelfbridge from source ourselves rather than pulling a published image:
# upstream (selmant/shelfbridge) publishes goreleaser binaries only — no container
# image (checked 2026-07-19; ghcr.io/selmant/shelfbridge is not populated). The
# build mirrors upstream's own Dockerfile: golang builder → CGO_ENABLED=0 go build
# -trimpath -ldflags="-s -w" ./cmd/shelfbridge → alpine runtime with ca-certificates,
# USER 65532, EXPOSE 8787.
#
# The pin advances via Renovate's git-refs custom manager (see renovate.json —
# SHELFBRIDGE_SOURCE_REF); upstream has no tagged releases yet, so we pin main's
# HEAD commit like redlib.

# Pinned shelfbridge commit. Advanced by Renovate's git-refs manager (renovate.json).
# Declared globally so both the builder and release stages inherit the same value
# (redeclaring `ARG SHELFBRIDGE_SOURCE_REF` without a default in each stage pulls
# this default in) — the image revision label stays in lock-step with the checkout.
# renovate: datasource=git-refs depName=shelfbridge-source branch=main
ARG SHELFBRIDGE_SOURCE_REF=6551bc2464d76f4e119a229aa7168e26447e2604

########################
## builder image
########################
# renovate: datasource=docker depName=golang
FROM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS builder

RUN apk add --no-cache git ca-certificates

ARG SHELFBRIDGE_SOURCE_REF

WORKDIR /shelfbridge
RUN set -e \
  && git init -q . \
  && git remote add origin https://github.com/selmant/shelfbridge.git \
  && git fetch -q --depth 1 origin "${SHELFBRIDGE_SOURCE_REF}" \
  && git checkout -q FETCH_HEAD

# Mirror upstream's Dockerfile: CGO disabled, trimmed static binary.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /shelfbridge-bin ./cmd/shelfbridge \
  && echo "finished building shelfbridge!"

########################
## release image
########################
# renovate: datasource=docker depName=alpine
FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS release

RUN apk add --no-cache ca-certificates

COPY --from=builder /shelfbridge-bin /usr/local/bin/shelfbridge

USER 65532:65532

EXPOSE 8787

HEALTHCHECK --interval=1m --timeout=3s CMD wget --spider -q http://localhost:8787/health || exit 1

ARG SHELFBRIDGE_SOURCE_REF
LABEL org.opencontainers.image.source="https://github.com/selmant/shelfbridge"
LABEL org.opencontainers.image.revision.shelfbridge="${SHELFBRIDGE_SOURCE_REF}"

ENTRYPOINT ["/usr/local/bin/shelfbridge"]
