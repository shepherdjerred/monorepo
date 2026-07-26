# bindery, built from upstream at a pinned commit with a local patch applied.
#
# We build bindery from source ourselves (rather than pulling the published
# docker.io/vavallee/bindery image) solely to apply 0001-gb-author-synthetic.patch,
# which lets Simplified/Traditional Chinese Google Books results — an author NAME
# but no author ID and no ISBN edition — be added to the wanted list instead of
# 422ing "Author metadata unavailable". See packages/docs/plans for the rationale.
#
# The build mirrors upstream's own Dockerfile (frontend → cross-compiled Go
# binary → distroless/static runtime), diverging only to satisfy this repo's
# Bun-only package-manager invariant: upstream builds the web frontend with
# `npm ci`, we build it with Bun (which migrates upstream's package-lock.json —
# there is no bun.lock to freeze against). The other additions are the source
# fetch + `git apply`, and a go-test stage that gates the build on the patch's
# behaviour.
#
# The pin advances via Renovate's git-refs custom manager (see renovate.json —
# BINDERY_SOURCE_REF); upstream tags releases, but we track main's HEAD like
# shelfbridge so the patch is validated against the latest source each bump.

# Pinned bindery commit. Advanced by Renovate's git-refs manager (renovate.json).
# Declared globally so every stage inherits the same value (redeclaring
# `ARG BINDERY_SOURCE_REF` without a default in a stage pulls this default in).
# renovate: datasource=git-refs depName=bindery-source branch=main
ARG BINDERY_SOURCE_REF=27e9049ce4758ee7afa12c9148389934372bbadb

########################
## source: fetch upstream + apply our patch
########################
# renovate: datasource=docker depName=alpine
FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS source

RUN apk add --no-cache git

ARG BINDERY_SOURCE_REF

WORKDIR /src
COPY 0001-gb-author-synthetic.patch /tmp/0001-gb-author-synthetic.patch
RUN set -e \
  && git init -q . \
  && git remote add origin https://github.com/vavallee/bindery.git \
  && git fetch -q --depth 1 origin "${BINDERY_SOURCE_REF}" \
  && git checkout -q FETCH_HEAD \
  && git apply --verbose /tmp/0001-gb-author-synthetic.patch \
  && echo "applied gb:author synthetic patch"

########################
## frontend build (native arch — output is arch-agnostic JS)
##
## Bun, not npm, per the monorepo's Bun-only invariant. Upstream ships only an
## npm package-lock.json (no bun.lock), copied here via the package*.json glob,
## so Bun migrates that lockfile on install. --frozen-lockfile is intentionally
## omitted: there is no committed bun.lock to freeze against, and the source
## tree is fetched fresh each build, so a frozen install would fail with
## "lockfile had changes, but lockfile is frozen".
########################
# renovate: datasource=docker depName=oven/bun
FROM --platform=$BUILDPLATFORM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS frontend
WORKDIR /app/web
COPY --from=source /src/web/package*.json ./
RUN bun install
COPY --from=source /src/web/ .
RUN bun run build

########################
## Go builder (native on BUILDPLATFORM, cross-compile to TARGETOS/TARGETARCH)
########################
# renovate: datasource=docker depName=golang
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS builder
WORKDIR /app
COPY --from=source /src/go.mod /src/go.sum ./
RUN go mod download
COPY --from=source /src/ .
COPY --from=frontend /app/web/dist ./internal/webui/dist

# Gate: the patch's behaviour must hold, or the image build fails. This is what
# catches upstream drift (a moved BINDERY_SOURCE_REF) that breaks the patch —
# the Renovate bump PR goes red here instead of silently shipping the old 422.
RUN CGO_ENABLED=0 go test ./internal/api/ -run TestAddBook_AuthorlessGoogleBooks -count=1

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE=unknown
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags="-w -s -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.date=${BUILD_DATE}" \
    -o /bindery ./cmd/bindery

########################
## Minimal runtime
########################
FROM gcr.io/distroless/static-debian12:nonroot@sha256:aef9602f8710ec12bde19d593fed1f76c708531bb7aba205110f1029786ead7b
# OCI metadata: the image is a patched build of the MIT-licensed upstream.
LABEL org.opencontainers.image.title="Bindery (sjer.red patched)" \
      org.opencontainers.image.description="Automated book download manager — patched to add Chinese Google Books results" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/vavallee/bindery" \
      org.opencontainers.image.url="https://github.com/vavallee/bindery"
ARG BINDERY_SOURCE_REF
LABEL org.opencontainers.image.revision.bindery="${BINDERY_SOURCE_REF}"
COPY --from=builder /bindery /bindery
USER nonroot
EXPOSE 8787
# No shell in distroless, so invoke the binary directly. The healthcheck
# subcommand hits /api/v1/health on localhost and exits 0/1 accordingly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["/bindery", "healthcheck"]
ENTRYPOINT ["/bindery"]
